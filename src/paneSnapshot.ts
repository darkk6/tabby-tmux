import { buildModeSequences, PaneState } from './paneState'

/** A snapshot separates scrollback from both terminal screens. */
export interface PaneSnapshot {
    /** null means no history was captured; an empty string can be a real blank row. */
    scrollback: string | null
    /** Logical lines, so xterm can reconstruct normal-screen soft wraps. */
    normalScreen: string
    /** Physical rows of the active alternate screen, or null in normal mode. */
    alternateScreen: string | null
    historyJoinsScreen: boolean
    state: PaneState
    /** Last %output received before the active-screen response completed. */
    outputSequence: number
}

const csi = (value: string) => `\x1b[${value}`

/**
 * trzsz writes its transfer protocol into the pane before restoring the
 * cursor and clearing the visible screen. Lines that already reached tmux's
 * scrollback survive that clear and would otherwise be replayed as user text.
 * In the active screen, blank matching rows in place to preserve screen and
 * cursor coordinates; in scrollback, remove the rows from restored history.
 */
function filterTrzszProtocolLines(content: string, preserveRows = false): string {
    const protocolLine = /^[\t ]*(?:::TRZSZ:TRANSFER:|#(?:CFG|NUM|NAME|SIZE|DATA|MD5|SUCC|FAIL):)/
    return content
        .split('\n')
        .map((line) => {
            if (!protocolLine.test(line.replace(/\x1b\[[0-9;:]*m/g, ''))) return line
            return preserveRows ? '' : null
        })
        .filter((line): line is string => line !== null)
        .join('\n')
}

/**
 * Capture newlines describe row boundaries, not the application's original
 * LF/SGR ordering. Scroll with the default background so xterm's BCE does not
 * fill newly allocated blank cells with the preceding row's last color.
 * Restore that background for the next row: tmux emits SGR differences across
 * rows, so resetting all attributes at each newline would lose real colors.
 */
function restoreLogicalContent(content: string): string {
    let background = ''
    return content.replace(/\x1b\[([0-9;:]*)m|\n/g, (sequence, parameters: string | undefined) => {
        if (parameters === undefined) {
            return background ? csi('49m') + '\r\n' + background : '\r\n'
        }
        const parts = parameters.split(';')
        for (let i = 0; i < parts.length; i++) {
            const subparameters = parts[i].split(':')
            const code = Number(subparameters[0])
            if (code === 0 || code === 49) {
                background = ''
            } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
                background = csi(`${code}m`)
            } else if (code === 38 || code === 48 || code === 58) {
                // Consume extended foreground/underline colors too: RGB or
                // palette components such as 0, 46 or 49 are not SGR commands.
                const count =
                    subparameters.length > 1
                        ? 0
                        : parts[i + 1] === '2'
                          ? 4
                          : parts[i + 1] === '5'
                            ? 2
                            : 0
                if (code === 48 && (subparameters.length > 1 || count > 0)) {
                    background = csi(parts.slice(i, i + count + 1).join(';') + 'm')
                }
                i += count
            }
        }
        return sequence
    })
}

/**
 * Draw a captured frame without scrolling its bottom row or allowing the
 * application's insert/origin/scroll-region modes to change its placement.
 */
function drawAlternateScreen(content: string, rows: number): string {
    let result = csi('?6l') + csi('r') + csi('4l') + csi('?7l') + csi('0m') + csi('2J')
    for (const [row, text] of content.split('\n').slice(0, rows).entries()) {
        result += csi(`${row + 1};1H`) + text
    }
    return result
}

export function buildSnapshotRestore(snapshot: PaneSnapshot): string {
    const { state } = snapshot
    // Select normal first, then erase an earlier local restoration, including
    // its scrollback. Restore in neutral modes; apply the captured modes last.
    let result =
        csi('?1047l') +
        csi('?6l') +
        csi('r') +
        csi('4l') +
        csi('?7h') +
        csi('0m') +
        csi('2J') +
        csi('3J') +
        csi('H')

    if (snapshot.scrollback !== null) {
        result += restoreLogicalContent(filterTrzszProtocolLines(snapshot.scrollback)) + csi('0m')
        if (!snapshot.historyJoinsScreen) result += '\r\n'
    }
    // Do not trim/deduplicate captured rows: blank rows and repeated content
    // are real terminal data. Reset SGR at the separately captured boundary.
    result +=
        csi('0m') + restoreLogicalContent(filterTrzszProtocolLines(snapshot.normalScreen, true))

    if (snapshot.alternateScreen !== null) {
        // 1049 saves the normal cursor for the application's eventual rmcup.
        // The -a capture is this saved normal screen, not the Vim frame.
        const x = Math.max(0, Math.min((state.columns ?? 1) - 1, state.alternateSavedX))
        const y = Math.max(0, Math.min((state.rows ?? 1) - 1, state.alternateSavedY))
        result += csi('0m') + csi(`${y + 1};${x + 1}H`) + csi('?1049h')
        result += drawAlternateScreen(snapshot.alternateScreen, state.rows ?? 1)
    }

    // Capture colors describe cells, not the application's current pen. Do
    // not leak the footer's final style into later text, erases, or resizes.
    return result + csi('0m') + buildModeSequences(state)
}
