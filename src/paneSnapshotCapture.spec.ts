import { describe, expect, it, vi } from 'vitest'
import type { ConfigService, Logger } from 'tabby-core'
import type { Injector } from '@angular/core'
import { TmuxController, TmuxPaneSession } from './session'

vi.mock('tabby-terminal', async () => {
    const { Subject } = await import('rxjs')
    return {
        BaseSession: class {
            output$ = new Subject<Buffer>()
            open = true
            constructor(protected logger: Logger) {}
            protected emitOutput(data: Buffer): void {
                this.output$.next(data)
            }
            async destroy(): Promise<void> {
                this.output$.complete()
            }
        },
    }
})

function state(alternate = false, history = 0, rows = 3): string {
    return (
        `pane_id=%1\talternate_on=${Number(alternate)}\t` +
        `cursor_x=0\tcursor_y=0\tpane_width=12\tpane_height=${rows}\t` +
        `history_size=${history}\talternate_saved_x=5\talternate_saved_y=0`
    )
}

function setup(respond: (command: string) => string | Promise<string>) {
    const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } as unknown as Logger
    const controller = new TmuxController(
        logger,
        null as unknown as Injector,
        () => undefined,
        () => undefined,
        { store: { tmuxPlugin: {} } } as ConfigService,
    )
    const commands = vi
        .spyOn(controller.gateway, 'sendCommand')
        .mockImplementation(async (command, _flags, onSuccess) => {
            const response = await respond(command)
            onSuccess?.()
            return response
        })
    return { controller, commands, logger }
}

describe('pane snapshot capture', () => {
    it('does not capture nonexistent history or request -a in normal mode', async () => {
        const { controller, commands } = setup((command) =>
            command.startsWith('list-panes') ? state() : 'shell\n\n',
        )
        expect(await controller.ensurePaneSnapshot(1)).toBe(true)
        expect(
            commands.mock.calls.map(([command]) => command).filter((c) => c.startsWith('capture')),
        ).toEqual(['capture-pane -peJN -S0 -t %1'])
        expect(
            commands.mock.calls.filter(([command]) => command.startsWith('list-panes')),
        ).toHaveLength(2)
    })

    it('keeps saved normal and active Vim captures in their correct buffers', async () => {
        const { controller, commands } = setup((command) => {
            if (command.startsWith('list-panes')) return state(true, 1)
            if (command.includes('-E-1')) return 'history'
            if (command.includes('-E0')) return 'history\nVIM'
            if (command.includes('-a ')) return 'shell$ vim\n\n'
            return 'VIM\neditor\nstatus'
        })
        await controller.ensurePaneSnapshot(1)
        const session = new TmuxPaneSession({ warn: vi.fn() } as unknown as Logger, controller, 1)
        const output: string[] = []
        session.output$.subscribe((data) => output.push(data.toString()))
        const starting = session.start()
        session.gridApplied()
        await starting
        const [normal, alternate] = output.join('').split('\x1b[?1049h')
        expect(normal).toContain('history\x1b[0m\r\n')
        expect(normal).toContain('shell$ vim')
        expect(normal).not.toContain('VIM')
        expect(alternate).toContain('VIM')
        expect(alternate).not.toContain('shell$ vim')
        expect(commands.mock.calls.every(([, flags]) => !flags)).toBe(true)
    })

    it('does not consume a snapshot inside a fragmented live title sequence', async () => {
        const { controller, logger } = setup((command) =>
            command.startsWith('list-panes') ? state() : 'shell frame\n\n',
        )
        controller.gateway.output$.next({ paneId: 1, data: Buffer.from('\x1bkunfinished title') })
        await controller.ensurePaneSnapshot(1)
        const session = new TmuxPaneSession(logger, controller, 1)
        const output: string[] = []
        session.output$.subscribe((data) => output.push(data.toString()))
        const starting = session.start()
        session.gridApplied()
        await starting
        expect(output.join('')).toContain('shell frame')

        controller.gateway.output$.next({ paneId: 1, data: Buffer.from(' end\x1b\\after title') })
        expect(output[output.length - 1]).toBe('after title')
        expect(output.join('')).not.toContain('unfinished title')
    })

    it('retries if Vim exits between frame capture and the closing state fence', async () => {
        const states = [state(true), state(false), state(false), state(false)]
        const { controller, commands } = setup((command) => {
            if (command.startsWith('list-panes')) return states.shift()
            return command.includes('-peN ') ? 'old Vim\n\n' : 'current shell\n\n'
        })
        expect(await controller.ensurePaneSnapshot(1)).toBe(true)
        const requests = commands.mock.calls.map(([command]) => command)
        expect(requests.filter((c) => c.startsWith('list-panes'))).toHaveLength(4)
        expect(requests.filter((c) => c.includes('-a '))).toHaveLength(1)
    })

    it('retries if the pane changes size during capture', async () => {
        const states = [
            state(false, 0, 3),
            state(false, 0, 4),
            state(false, 0, 4),
            state(false, 0, 4),
        ]
        const { controller, commands } = setup((command) =>
            command.startsWith('list-panes') ? states.shift() : 'shell\n\n\n',
        )
        expect(await controller.ensurePaneSnapshot(1)).toBe(true)
        expect(
            commands.mock.calls.filter(([command]) => command.startsWith('list-panes')),
        ).toHaveLength(4)
    })

    it('rejects invalid or missing pane geometry instead of rendering a fake frame', async () => {
        const { controller, commands } = setup(() => 'pane_id=%1\tpane_width=\tpane_height=')
        expect(await controller.ensurePaneSnapshot(1)).toBe(false)
        expect(commands).toHaveBeenCalledTimes(3)
    })

    it("does not give an unmounted pane's in-flight snapshot to its replacement", async () => {
        let finishCapture: (value: string) => void
        const { controller, commands } = setup((command) =>
            command.startsWith('list-panes')
                ? state()
                : new Promise((resolve) => (finishCapture = resolve)),
        )
        const session = new TmuxPaneSession({ warn: vi.fn() } as unknown as Logger, controller, 1)
        const capturing = controller.ensurePaneSnapshot(1, true)
        await vi.waitFor(() =>
            expect(commands.mock.calls.some(([command]) => command.startsWith('capture'))).toBe(
                true,
            ),
        )
        await session.destroy()
        new TmuxPaneSession({ warn: vi.fn() } as unknown as Logger, controller, 1)
        finishCapture('old screen\n\n')
        expect(await capturing).toBe(false)
        expect(controller.hasPendingSnapshot(1)).toBe(false)
    })

    it('rejects capture errors and preserves live output when no snapshot succeeds', async () => {
        const { controller } = setup((command) => {
            if (command.startsWith('list-panes')) return state()
            return Promise.reject(new Error('capture failed'))
        })
        controller.gateway.output$.next({ paneId: 1, data: Buffer.from('live output') })
        const session = new TmuxPaneSession({ warn: vi.fn() } as unknown as Logger, controller, 1)
        const output: string[] = []
        session.output$.subscribe((data) => output.push(data.toString()))
        const starting = session.start()
        session.gridApplied()
        await starting
        expect(output).toEqual(['live output'])
        expect(controller.hasPendingSnapshot(1)).toBe(false)
    })
})
