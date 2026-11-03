import { Subject } from 'rxjs'
import { Logger, ConfigService } from 'tabby-core'
import { createConditionalLogger, ConditionalLogger } from './logHelper'
import { tmuxKeyNameForSequence } from './tmuxInputKeys'

// Command flags
export const TMUX_COMMAND_TOLERATE_ERRORS = 1 << 0
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000
const DEFAULT_SEND_KEYS_CHUNK_SIZE = 200

interface PendingCommand {
    id: number
    command: string
    resolve: (result: string) => void
    reject: (error: Error) => void
    flags: number
    timestamp: number
    onSuccess?: () => void
}

type PendingResponse = { type: 'command'; command: PendingCommand } | { type: 'direct-write' }

export interface TmuxCommand {
    command: string
    flags?: number
    onSuccess?: () => void
}

export interface TmuxLayoutChange {
    windowId: number
    layout: string
    visibleLayout?: string
    zoomed?: boolean
}

/** Format whose output matches the %layout-change arguments, for parseLayoutChangeFields. */
export const TMUX_LAYOUT_CHANGE_FORMAT =
    '#{window_id} #{window_layout} #{window_visible_layout} #{window_raw_flags}'

/**
 * Parse the %layout-change arguments: `@<window> <layout> [visible_layout
 * raw_flags]`. TMUX_LAYOUT_CHANGE_FORMAT produces the same fields, for
 * commands that rearrange panes without notifying control clients.
 */
export function parseLayoutChangeFields(text: string): TmuxLayoutChange | null {
    const match = text.match(/^@(\d+) (.+)$/)
    if (!match) return null

    const windowId = parseInt(match[1])
    const parts = match[2].split(' ')
    const layout = parts[0]
    const visibleLayout = parts.length > 1 ? parts[1] : undefined
    const zoomed = parts.length > 2 ? parts[2].includes('Z') : undefined

    return { windowId, layout, visibleLayout, zoomed }
}
/**
 * TmuxGateway - Protocol layer for tmux control mode
 *
 * Handles:
 * - Command queuing with response matching
 * - Protocol parsing (%begin/%end/%error blocks)
 * - Notification dispatch
 * - Key encoding and sending
 */
export class TmuxGateway {
    /**
     * Responses are tracked in the same order commands are written to tmux.
     * This includes send-keys, whose response is intentionally fire-and-forget:
     * Control Mode still emits a %begin/%end block for it, and that block must
     * not consume the response promise of a command written afterwards.
     */
    private responseQueue: PendingResponse[] = []
    private currentCommand: PendingCommand | null = null
    private currentCommandId = ''
    private currentResponse: string[] = []
    private inResponseBlock = false
    private nextCommandId = 1
    private disconnected = false
    private detachSent = false
    private acceptNotifications = false
    private initialized = false
    /** Incomplete trailing line of the previous PTY packet, kept as bytes */
    private lineBuffer: Buffer = Buffer.alloc(0)

    // Events for notifications
    public output$ = new Subject<{ paneId: number; data: Buffer; latency?: number }>()
    public layoutChange$ = new Subject<TmuxLayoutChange>()
    public windowAdd$ = new Subject<number>()
    public windowClose$ = new Subject<number>()
    public windowRenamed$ = new Subject<{ windowId: number; name: string }>()
    public sessionChanged$ = new Subject<{ sessionName: string; sessionId: number }>()
    public sessionsChanged$ = new Subject<void>()
    public paneChanged$ = new Subject<{ windowId: number; paneId: number }>()
    public sessionWindowChanged$ = new Subject<{ windowId: number }>()
    public paneClose$ = new Subject<{ windowId: number; paneId: number }>()
    public exit$ = new Subject<string>()
    public initialized$ = new Subject<void>()

    constructor(
        private logger: Logger,
        private writer: (data: string) => void,
        private configService?: ConfigService,
    ) {}

    private get log(): ConditionalLogger {
        return createConditionalLogger(this.logger, this.configService)
    }

    private get commandTimeoutMs(): number {
        return this.configService?.store.tmuxPlugin?.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
    }

    private get sendKeysChunkSize(): number {
        return (
            this.configService?.store.tmuxPlugin?.sendKeysChunkSize ?? DEFAULT_SEND_KEYS_CHUNK_SIZE
        )
    }

    /**
     * Send a single command and wait for response
     */
    async sendCommand(command: string, flags = 0, onSuccess?: () => void): Promise<string> {
        const [response] = await this.sendCommands([{ command, flags, onSuccess }])
        return response
    }

    /**
     * Queue independent commands in one transport write. In particular, a
     * snapshot's closing state query must reach tmux alongside its captures,
     * rather than after megabytes of capture output have crossed the network.
     * Use separate lines: a failure in a semicolon sequence skips later commands
     * and would leave their response slots unmatched.
     */
    async sendCommands(commands: TmuxCommand[]): Promise<string[]> {
        if (this.detachSent || this.disconnected) {
            throw new Error('Gateway disconnected')
        }
        const responses = commands.map(({ command, flags = 0, onSuccess }) =>
            this.queueCommand(command, flags, onSuccess),
        )
        const result = Promise.all(responses)
        try {
            if (commands.length) this.write(commands.map(({ command }) => command + '\r').join(''))
        } catch (error) {
            this.dispose(error instanceof Error ? error : new Error(String(error)))
        }
        return result
    }

    private queueCommand(command: string, flags: number, onSuccess?: () => void): Promise<string> {
        const original = new Promise<string>((resolve, reject) => {
            const cmd: PendingCommand = {
                id: this.nextCommandId++,
                command,
                resolve,
                reject,
                flags,
                timestamp: Date.now(),
                onSuccess,
            }
            this.responseQueue.push({ type: 'command', command: cmd })
            this.log.debug(`Sent command: ${command}`)
        })

        // Race against timeout — if tmux never responds, reject instead of hanging
        let timer: ReturnType<typeof setTimeout>
        const timeout = new Promise<string>((_, reject) => {
            timer = setTimeout(() => {
                // The command was written to tmux immediately, so a timeout
                // cannot cancel it. Keep its response slot until tmux sends the
                // response; otherwise a late response would be assigned to the
                // next command and corrupt the entire response sequence.
                reject(new Error(`Command timed out after ${this.commandTimeoutMs}ms: ${command}`))
            }, this.commandTimeoutMs)
        })

        // Clean up timer when original settles
        original.then(
            () => clearTimeout(timer!),
            () => clearTimeout(timer!),
        )

        return Promise.race([original, timeout])
    }

    /**
     * Send keystrokes to a specific pane.
     *
     * Writes directly to the PTY for zero-latency input. Tmux still sends a
     * %begin/%end response for each send-keys command, so each write is added
     * to the response queue before it is sent. This keeps later queued command
     * responses aligned even when the user types while a command is pending.
     */
    sendKeys(data: Buffer, paneId: number): void {
        if (this.detachSent || this.disconnected) return

        // A lone Home/End (plain or with modifiers) must reach the pane the
        // way TUI tmux would encode it, not as the raw xterm sequence: zsh
        // binds End through $terminfo[kend] (ESC [ 4 ~), which never matches
        // xterm's ESC [ F. Hand such keys to tmux by name so it encodes them
        // for the pane's TERM and cursor-key mode. See tmuxInputKeys.ts.
        const keyName = tmuxKeyNameForSequence(data)
        if (keyName) {
            this.responseQueue.push({ type: 'direct-write' })
            this.write(`send-keys -t %${paneId} ${keyName}\r`)
            return
        }

        const hex = data.toString('hex')
        if (hex.length > 0) {
            // Split into chunks to avoid command length limits
            for (let i = 0; i < hex.length; i += this.sendKeysChunkSize) {
                const chunk = hex.substring(i, i + this.sendKeysChunkSize)
                const hexBytes = chunk.match(/.{2}/g)?.join(' ') || ''
                // Write directly — bypasses command queue for zero-latency input,
                // but retain its response placeholder to preserve response order.
                this.responseQueue.push({ type: 'direct-write' })
                this.write(`send-keys -t %${paneId} -H ${hexBytes}\r`)
            }
        }
    }

    /**
     * Request detach
     */
    detach(): void {
        if (!this.detachSent && !this.disconnected) {
            this.write('detach\r')
            this.detachSent = true
        }
    }

    /**
     * Feed raw PTY data.  Buffers incomplete lines across calls so that TCP
     * fragment boundaries never split a protocol line.
     *
     * Empty lines are forwarded too: inside a response block they are real
     * output lines (tmux terminates EVERY output line with CRLF and adds no
     * extra terminator — verified against tmux 3.4 for display-message,
     * list-windows, list-panes and capture-pane), so a blank line is e.g. a
     * blank screen row of capture-pane output. Dropping it loses that row and
     * shifts everything below it up. executeLine() discards blank lines that
     * are outside a response block.
     */
    executeData(data: Buffer): void {
        // Split on bytes, not on a decoded string: a PTY/SSH packet boundary
        // can fall inside a multi-byte UTF-8 character of an %output payload,
        // and decoding each packet on its own would turn both halves into
        // U+FFFD replacement characters.
        const buffer = this.lineBuffer.length > 0 ? Buffer.concat([this.lineBuffer, data]) : data
        let start = 0
        let newlineIdx: number
        while ((newlineIdx = buffer.indexOf(0x0a, start)) !== -1) {
            let end = newlineIdx
            if (end > start && buffer[end - 1] === 0x0d) end--
            this.executeLineBytes(buffer.subarray(start, end))
            start = newlineIdx + 1
        }
        // Copy the leftover so the packet it came from can be released.
        this.lineBuffer =
            start < buffer.length ? Buffer.from(buffer.subarray(start)) : Buffer.alloc(0)
    }

    /**
     * Dispatch one complete protocol line received as bytes.
     *
     * %output / %extended-output payloads stay bytes: tmux forwards the pane's
     * raw UTF-8 (only bytes below 0x20 and the backslash are octal-escaped)
     * and may split a character across two %output lines, so the payload must
     * not be decoded to a string here. Every other line is complete text.
     */
    private executeLineBytes(raw: Buffer): void {
        const payloadStart = this.outputPayloadStart(raw)
        if (payloadStart === -1) {
            this.executeLine(raw.toString('utf-8'))
            return
        }
        // Same artifact as executeLine's trailing-ST strip. tmux octal-escapes
        // every payload byte below 0x20, so a raw ESC can only be an artifact.
        let end = raw.length
        if (end >= 2 && raw[end - 2] === 0x1b && raw[end - 1] === 0x5c) end -= 2
        this.executeLine(raw.toString('latin1', 0, payloadStart), raw.subarray(payloadStart, end))
    }

    /**
     * Byte offset where an %output / %extended-output payload starts (after
     * the DCS artifacts executeLine strips and the header), or -1 when the
     * line is not pane output.
     */
    private outputPayloadStart(raw: Buffer): number {
        // latin1 maps one byte to one char, so string offsets are byte offsets.
        const head = raw.toString('latin1', 0, Math.min(raw.length, 64))
        const match = /^(?:\x1bP\d+p|P\d+p)?(?:%output %\d+ |%extended-output %\d+ \d+ : )/.exec(
            head,
        )
        return match ? match[0].length : -1
    }

    /**
     * Process a single complete line from tmux control mode.
     *
     * `payload` carries the undecoded bytes of an %output / %extended-output
     * line (see executeLineBytes); `line` is then just the header. Without it
     * the whole line, payload included, is parsed from the string.
     */
    executeLine(line: string, payload?: Buffer): void {
        // Strip DCS artifacts
        line = line
            .replace(/^\x1bP\d+p/, '')
            .replace(/^P\d+p/, '')
            .replace(/\x1b\\$/, '')
        if (!line) {
            // Blank line: response data (see executeData) or stream noise.
            if (this.inResponseBlock) {
                this.currentResponse.push('')
            }
            return
        }

        this.log.info(
            `Received: ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}` +
                (payload ? ` [${payload.length} payload bytes]` : ''),
        )

        // Handle response blocks
        if (this.inResponseBlock) {
            if (line.startsWith(`%end ${this.currentCommandId}`) || line.startsWith(`%end `)) {
                this.finishCurrentCommand(false)
                return
            } else if (
                line.startsWith(`%error ${this.currentCommandId}`) ||
                line.startsWith(`%error `)
            ) {
                this.finishCurrentCommand(true)
                return
            } else if (line.startsWith('%exit')) {
                // Tmux 1.8 bug workaround
                this.finishCurrentCommand(false)
                // Fall through to handle %exit
            } else if (line.startsWith('%output ') || line.startsWith('%extended-output ')) {
                // Dispatch pane output notifications even during response blocks.
                // Otherwise they get accumulated as garbage text in the command
                // response (e.g. capture-pane) and the live output is lost.
                if (this.acceptNotifications) {
                    if (line.startsWith('%output ')) {
                        this.parseOutput(line, payload)
                    } else {
                        this.parseExtendedOutput(line, payload)
                    }
                }
                return
            } else {
                // Accumulate response
                this.currentResponse.push(line)
                return
            }
        }

        // Handle notifications and commands
        if (line.startsWith('%begin')) {
            this.parseBegin(line)
        } else if (line.startsWith('%output ')) {
            if (this.acceptNotifications) {
                this.log.info(`Parsing output line: ${line.substring(0, 50)}...`)
                this.parseOutput(line, payload)
            } else {
                this.log.warn(
                    `Ignored output (not accepting notifications): ${line.substring(0, 50)}...`,
                )
            }
        } else if (line.startsWith('%extended-output ')) {
            if (this.acceptNotifications) {
                this.parseExtendedOutput(line, payload)
            }
        } else if (line.startsWith('%layout-change ')) {
            if (this.acceptNotifications) {
                this.parseLayoutChange(line)
            }
        } else if (line.startsWith('%window-add')) {
            if (this.acceptNotifications) {
                this.parseWindowAdd(line)
            }
        } else if (line.startsWith('%window-close') || line.startsWith('%unlinked-window-close')) {
            if (this.acceptNotifications) {
                this.parseWindowClose(line)
            }
        } else if (
            line.startsWith('%window-renamed') ||
            line.startsWith('%unlinked-window-renamed')
        ) {
            if (this.acceptNotifications) {
                this.parseWindowRenamed(line)
            }
        } else if (line.startsWith('%session-changed')) {
            this.parseSessionChanged(line)
        } else if (line.startsWith('%sessions-changed')) {
            if (this.acceptNotifications) {
                this.sessionsChanged$.next()
            }
        } else if (line.startsWith('%session-window-changed')) {
            if (this.acceptNotifications) {
                this.parseSessionWindowChanged(line)
            }
        } else if (line.startsWith('%window-pane-changed')) {
            if (this.acceptNotifications) {
                this.parsePaneChanged(line)
            }
        } else if (line.startsWith('%pane-close') || line.startsWith('%unlinked-pane-close')) {
            if (this.acceptNotifications) {
                this.parsePaneClose(line)
            }
        } else if (line.startsWith('%pause') || line.startsWith('%continue')) {
            // Flow control notifications (tmux 3.2+) — acknowledged
            this.log.debug(`Flow control: ${line}`)
        } else if (line.startsWith('%no-output')) {
            // Empty response block — no action needed
        } else if (line.startsWith('%exit')) {
            this.parseExit(line)
        } else if (line.startsWith('%')) {
            // Unknown notification, ignore
            this.log.debug(`Unknown notification: ${line}`)
        }
    }

    // --- Protocol Parsing ---

    private parseBegin(line: string): void {
        // %begin timestamp commandId flags
        // Format: %begin 1767853190 875 1
        // tmux Control Mode docs: flags is always 1 for client-originated.
        const parts = line.split(' ')
        if (parts.length < 3) {
            this.logger.warn(`Malformed %begin: ${line}`)
            return
        }

        const commandId = parts[2]
        this.currentCommandId = commandId
        this.currentResponse = []
        this.inResponseBlock = true

        const pendingResponse = this.responseQueue.shift()
        if (pendingResponse?.type === 'command') {
            this.currentCommand = pendingResponse.command
        } else {
            // Direct writes and server-initiated response blocks do not have a
            // promise to resolve, but still occupy a response slot.
            this.currentCommand = null
        }

        if (!pendingResponse) {
            this.log.debug(`Received response for an unknown command: ${commandId}`)
        }
    }

    private finishCurrentCommand(isError: boolean): void {
        this.inResponseBlock = false
        const response = this.currentResponse.join('\n')

        if (this.currentCommand) {
            if (isError && !(this.currentCommand.flags & TMUX_COMMAND_TOLERATE_ERRORS)) {
                this.currentCommand.reject(new Error(response))
            } else {
                // Run at the protocol boundary, before processing subsequent
                // %output lines in the same PTY chunk (a promise is too late).
                if (!isError) this.currentCommand.onSuccess?.()
                this.currentCommand.resolve(response)
            }
            this.currentCommand = null
        }

        // Mark as initialized after first successful response
        if (!this.initialized) {
            this.initialized = true
            this.acceptNotifications = true
            this.initialized$.next()
        }
    }

    private parseOutput(line: string, payload?: Buffer): void {
        // %output %<pane> <data>
        const match = line.match(/^%output %(\d+) (.*)$/)
        if (!match) {
            this.logger.error(`Output regex FAILED for line: <${line}>`)
            return
        }

        const paneId = parseInt(match[1])
        const data = payload ? this.decodeOutputBytes(payload) : this.decodeOutput(match[2])
        this.log.info(`Parsed output for pane %${paneId}: ${data.length} bytes`)
        this.output$.next({ paneId, data })
    }

    private parseExtendedOutput(line: string, payload?: Buffer): void {
        // %extended-output %<pane> <latency> : <data>
        const match = line.match(/^%extended-output %(\d+) (\d+) : (.*)$/)
        if (!match) return

        const paneId = parseInt(match[1])
        const latency = parseInt(match[2]) / 1000 // Convert ms to seconds
        const data = payload ? this.decodeOutputBytes(payload) : this.decodeOutput(match[3])
        this.output$.next({ paneId, data, latency })
    }

    private parseLayoutChange(line: string): void {
        const change = parseLayoutChangeFields(line.slice('%layout-change '.length))
        if (change) {
            this.layoutChange$.next(change)
        }
    }

    private parseWindowAdd(line: string): void {
        // %window-add @<id>
        const match = line.match(/^%window-add @(\d+)$/)
        if (match) {
            this.windowAdd$.next(parseInt(match[1]))
        }
    }

    private parseWindowClose(line: string): void {
        // %window-close @<id> or %unlinked-window-close @<id>
        const match = line.match(/@(\d+)$/)
        if (match) {
            this.windowClose$.next(parseInt(match[1]))
        }
    }

    private parseWindowRenamed(line: string): void {
        // %window-renamed @<id> <name>
        const match = line.match(/^%(?:unlinked-)?window-renamed @(\d+) (.+)$/)
        if (match) {
            this.windowRenamed$.next({
                windowId: parseInt(match[1]),
                name: this.unescapeTmuxWindowName(match[2]),
            })
        }
    }

    private parseSessionChanged(line: string): void {
        // %session-changed $<id> <name>
        const match = line.match(/^%session-changed \$(\d+) (.+)$/)
        if (match) {
            this.sessionChanged$.next({
                sessionId: parseInt(match[1]),
                sessionName: match[2],
            })
            // Enable notifications after session change
            this.acceptNotifications = true
        }
    }

    private parseSessionWindowChanged(line: string): void {
        // %session-window-changed $session @window
        const match = line.match(/^%session-window-changed \$\d+ @(\d+)/)
        if (match) {
            this.sessionWindowChanged$.next({
                windowId: parseInt(match[1]),
            })
        }
    }

    private parsePaneChanged(line: string): void {
        // %window-pane-changed @<window> %<pane>
        const match = line.match(/^%window-pane-changed @(\d+) %(\d+)$/)
        if (match) {
            this.paneChanged$.next({
                windowId: parseInt(match[1]),
                paneId: parseInt(match[2]),
            })
        }
    }

    private parsePaneClose(line: string): void {
        // %pane-close @<window> %<pane>
        const match = line.match(/^%(?:unlinked-)?pane-close @(\d+) %(\d+)$/)
        if (match) {
            this.paneClose$.next({
                windowId: parseInt(match[1]),
                paneId: parseInt(match[2]),
            })
        }
    }

    private parseExit(line: string): void {
        // %exit or %exit <reason>
        const reason = line.replace(/^%exit\s*/, '')
        this.disconnected = true
        this.exit$.next(reason)
    }

    /** Stop local work when the UI disconnects; detach itself is already written. */
    dispose(error = new Error('Gateway disconnected')): void {
        this.disconnected = true
        this.currentCommand?.reject(error)
        this.currentCommand = null
        for (const response of this.responseQueue) {
            if (response.type === 'command') response.command.reject(error)
        }
        this.responseQueue = []
        this.currentResponse = []
        this.inResponseBlock = false
        this.acceptNotifications = false
        this.lineBuffer = Buffer.alloc(0)
    }

    // --- Utility Methods ---

    private write(data: string): void {
        this.writer(data)
    }

    /**
     * Decode an %output payload: tmux octal-escapes bytes below 0x20 and the
     * backslash as \ooo and sends every other byte raw, UTF-8 included. The
     * bytes are forwarded exactly as tmux sent them — a character split
     * across two payloads is reassembled by TmuxPaneSession, not here.
     * Returns a copy, so the packet the payload came from can be released.
     */
    private decodeOutputBytes(payload: Buffer): Buffer {
        if (payload.indexOf(0x5c) === -1) return Buffer.from(payload)
        const isOctal = (b: number) => b >= 0x30 && b <= 0x37
        const out = Buffer.allocUnsafe(payload.length)
        let n = 0
        for (let i = 0; i < payload.length; i++) {
            const b = payload[i]
            if (
                b === 0x5c &&
                i + 3 < payload.length &&
                isOctal(payload[i + 1]) &&
                isOctal(payload[i + 2]) &&
                isOctal(payload[i + 3])
            ) {
                out[n++] =
                    ((payload[i + 1] - 0x30) << 6) |
                    ((payload[i + 2] - 0x30) << 3) |
                    (payload[i + 3] - 0x30)
                i += 3
                continue
            }
            out[n++] = b
        }
        return out.subarray(0, n)
    }

    /** Decode an %output payload given as a string (lines fed via executeLine). */
    private decodeOutput(str: string): Buffer {
        return this.decodeOutputBytes(Buffer.from(str, 'utf-8'))
    }

    private unescapeTmuxWindowName(name: string): string {
        // Tmux may escape window names
        return name.replace(/\\(.)/g, '$1')
    }
}
