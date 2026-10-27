import { afterEach, describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/headless'
import { parsePaneState } from './paneState'
import { buildSnapshotRestore, PaneSnapshot } from './paneSnapshot'

const terminals: Terminal[] = []
afterEach(() => terminals.splice(0).forEach((terminal) => terminal.dispose()))

function snapshot(overrides: Partial<PaneSnapshot> = {}): PaneSnapshot {
    return {
        scrollback: null,
        normalScreen: 'shell$ vim\n\n',
        alternateScreen: 'VIM\nline 2\nSTATUS',
        historyJoinsScreen: false,
        state: parsePaneState(
            'pane_id=%1\talternate_on=1\talternate_saved_x=10\talternate_saved_y=0\t' +
                'cursor_x=2\tcursor_y=1\tpane_width=12\tpane_height=3\thistory_size=0\t' +
                'scroll_region_upper=0\tscroll_region_lower=2\twrap_flag=0\tcursor_flag=1',
            1,
        ),
        outputSequence: 0,
        ...overrides,
    }
}

function write(terminal: Terminal, content: string): Promise<void> {
    return new Promise((resolve) => terminal.write(content, resolve))
}

async function restore(frame: PaneSnapshot): Promise<Terminal> {
    const terminal = new Terminal({
        cols: frame.state.columns,
        rows: frame.state.rows,
        scrollback: 1000,
        allowProposedApi: true,
    })
    terminals.push(terminal)
    await write(terminal, buildSnapshotRestore(frame))
    return terminal
}

function screen(terminal: Terminal): string[] {
    const buffer = terminal.buffer.active
    return Array.from({ length: terminal.rows }, (_, row) =>
        buffer.getLine(buffer.baseY + row)?.translateToString(true),
    )
}

describe('pane snapshot restoration in xterm', () => {
    it('does not insert a history row when history restoration is disabled', async () => {
        const frame = snapshot({ normalScreen: 'screen\n\n', alternateScreen: null })
        frame.state.alternateOn = false
        frame.state.historySize = 50000
        const terminal = await restore(frame)
        expect(terminal.buffer.normal.baseY).toBe(0)
        expect(screen(terminal)).toEqual(['screen', '', ''])
    })

    it('preserves a captured history row even when that row is blank', async () => {
        const frame = snapshot({
            scrollback: '',
            normalScreen: 'screen\n\n',
            alternateScreen: null,
        })
        frame.state.alternateOn = false
        frame.state.historySize = 50000
        const terminal = await restore(frame)
        expect(terminal.buffer.normal.baseY).toBe(1)
        expect(terminal.buffer.normal.getLine(0)?.translateToString(true)).toBe('')
        expect(screen(terminal)).toEqual(['screen', '', ''])
    })
    it('shows Vim in alternate and restores the saved shell and cursor on exit', async () => {
        const frame = snapshot({ scrollback: 'older\nlatest' })
        frame.state.historySize = 2
        const terminal = await restore(frame)
        expect(terminal.buffer.active.type).toBe('alternate')
        expect(screen(terminal)).toEqual(['VIM', 'line 2', 'STATUS'])
        expect(terminal.buffer.active.cursorX).toBe(2)
        expect(terminal.buffer.active.cursorY).toBe(1)

        await write(terminal, '\x1b[?1049l')
        expect(screen(terminal)).toEqual(['shell$ vim', '', ''])
        expect(terminal.buffer.active.cursorX).toBe(10)
        expect(terminal.buffer.active.cursorY).toBe(0)
        expect(terminal.buffer.normal.baseY).toBe(2)
        expect(terminal.buffer.normal.getLine(0)?.translateToString(true)).toBe('older')
    })

    it('draws full-width bottom rows before applying insert mode and scroll margins', async () => {
        const frame = snapshot({ alternateScreen: 'abcdefghijkl\nMNOPQRSTUVWX\n012345678901' })
        frame.state.insertFlag = true
        frame.state.scrollRegionUpper = 1
        frame.state.originFlag = true
        frame.state.cursorY = 1
        const terminal = await restore(frame)
        expect(screen(terminal)).toEqual(['abcdefghijkl', 'MNOPQRSTUVWX', '012345678901'])
        expect(terminal.buffer.active.cursorY).toBe(1)
        expect(terminal.modes.insertMode).toBe(true)
        expect(terminal.modes.originMode).toBe(true)
    })

    it('preserves blank rows, colored trailing spaces and wide characters', async () => {
        const frame = snapshot({ alternateScreen: '\n\x1b[44m中文   \x1b[0m\n' })
        const terminal = await restore(frame)
        expect(screen(terminal)).toEqual(['', '中文   ', ''])
        expect(terminal.buffer.active.getLine(1)?.getCell(5)?.getBgColor()).toBe(4)
    })

    it('does not leak the captured footer color into subsequent partial redraws', async () => {
        const frame = snapshot({ alternateScreen: 'process\nplain row\n\x1b[46mF1 Help F2' })
        const terminal = await restore(frame)
        expect(terminal.buffer.active.getLine(2)?.getCell(0)?.getBgColor()).toBe(6)
        // htop has already reset its pen after drawing the footer, but that
        // reset is absent from capture-pane's cell-derived color sequences.
        await write(terminal, '\x1b[2;1H\x1b[Kupdated\r\n')
        const line = terminal.buffer.active.getLine(1)
        expect(line?.translateToString(true)).toBe('updated')
        expect(line?.getCell(0)?.isBgDefault()).toBe(true)
        expect(line?.getCell(11)?.isBgDefault()).toBe(true)
    })

    it('does not fill unpainted screen rows with a preceding history background', async () => {
        const frame = snapshot({
            scrollback: '\x1b[46mhistory',
            normalScreen: '\x1b[39m\x1b[49mprocess\n\n',
            alternateScreen: null,
        })
        frame.state.alternateOn = false
        frame.state.historySize = 1
        const terminal = await restore(frame)
        expect(screen(terminal)).toEqual(['process', '', ''])
        const buffer = terminal.buffer.normal
        expect(buffer.getLine(buffer.baseY)?.getCell(11)?.isBgDefault()).toBe(true)
        expect(
            buffer
                .getLine(buffer.baseY + 1)
                ?.getCell(0)
                ?.isBgDefault(),
        ).toBe(true)
    })

    it.each([
        { color: '\x1b[46m', mode: 'palette', value: 6 },
        { color: '\x1b[106m', mode: 'palette', value: 14 },
        { color: '\x1b[48;5;42m', mode: 'palette', value: 42 },
        { color: '\x1b[48;2;0;49;255m', mode: 'rgb', value: 0x0031ff },
        { color: '\x1b[48:2::0:49:255m', mode: 'rgb', value: 0x0031ff },
        { color: '\x1b[46m\x1b[38;5;49m', mode: 'palette', value: 6, foreground: 49 },
        { color: '\x1b[46m\x1b[38;2;0;49;46m', mode: 'palette', value: 6, foreground: 0x00312e },
        { color: '\x1b[46m\x1b[58;5;49m', mode: 'palette', value: 6 },
    ])(
        'keeps $color on text across hard line breaks without painting blank tails',
        async ({ color, mode, value, foreground = 1 }) => {
            const frame = snapshot({
                scrollback: `older\nolder\n\x1b[1;31m${color}first\nsecond\n\x1b[0mplain`,
                normalScreen: 'end\n\n',
                alternateScreen: null,
            })
            frame.state.alternateOn = false
            frame.state.historySize = 5
            const terminal = await restore(frame)
            const buffer = terminal.buffer.normal
            // Scrolling the colored hard break must allocate a default-colored
            // row, even though capture-pane carries its SGR across row boundaries.
            for (const row of [2, 3]) {
                const cell = buffer.getLine(row)?.getCell(0)
                expect(cell?.getBgColor()).toBe(value)
                expect(mode === 'rgb' ? cell?.isBgRGB() : cell?.isBgPalette()).toBe(true)
                expect(cell?.getFgColor()).toBe(foreground)
                expect(cell?.isBold()).toBeTruthy()
                expect(buffer.getLine(row)?.getCell(11)?.isBgDefault()).toBe(true)
            }
            expect(buffer.getLine(4)?.getCell(11)?.isBgDefault()).toBe(true)
        },
    )

    it('restores the saved normal screen without inheriting its last captured color', async () => {
        const terminal = await restore(snapshot({ normalScreen: '\n\n\x1b[46mprompt' }))
        await write(terminal, '\x1b[?1049l\x1b[2;1H\x1b[Knext')
        expect(terminal.buffer.normal.getLine(1)?.getCell(0)?.isBgDefault()).toBe(true)
        expect(terminal.buffer.normal.getLine(1)?.getCell(11)?.isBgDefault()).toBe(true)
    })

    it('uses the captured normal cursor even at column zero before visible content', async () => {
        const frame = snapshot({ alternateScreen: null, normalScreen: '\nhello\n' })
        frame.state.alternateOn = false
        frame.state.cursorX = 0
        frame.state.cursorY = 1
        const terminal = await restore(frame)
        expect(screen(terminal)).toEqual(['', 'hello', ''])
        await write(terminal, 'X')
        expect(screen(terminal)).toEqual(['', 'Xello', ''])
    })

    it('keeps repeated history and blank history rows instead of deduplicating them', async () => {
        const frame = snapshot({
            scrollback: 'same\nsame\n',
            normalScreen: 'prompt\n\n',
            alternateScreen: null,
        })
        frame.state.alternateOn = false
        frame.state.historySize = 3
        const terminal = await restore(frame)
        expect(terminal.buffer.normal.baseY).toBe(3)
        expect(
            Array.from({ length: 3 }, (_, row) =>
                terminal.buffer.normal.getLine(row)?.translateToString(true),
            ),
        ).toEqual(['same', 'same', ''])
        expect(screen(terminal)).toEqual(['prompt', '', ''])
    })

    it('filters trzsz protocol rows from restored scrollback and preserves transfer summaries', async () => {
        const frame = snapshot({
            scrollback:
                'before transfer\n' +
                '                \x1b[32m#SUCC:20480\x1b[0m\n' +
                '  ::TRZSZ:TRANSFER:R:1.3.0:0291256133200:40323\n' +
                '#CFG:encoded-config\n' +
                '#NUM:1\n' +
                '#NAME:encoded-name\n' +
                '#SIZE:20480\n' +
                '#DATA:encoded-data\n' +
                '#MD5:encoded-checksum\n' +
                '#FAIL:encoded-error\n' +
                'Saved 1 file/directory to /Users/ruan\n' +
                'after transfer',
            normalScreen: 'shell$ ',
            alternateScreen: null,
        })
        frame.state.alternateOn = false
        frame.state.columns = 120

        const terminal = await restore(frame)
        const buffer = terminal.buffer.normal
        const restoredRows = Array.from({ length: buffer.baseY + terminal.rows }, (_, row) =>
            buffer.getLine(row)?.translateToString(true),
        )

        expect(restoredRows.join('\n')).toContain('before transfer')
        expect(restoredRows.join('\n')).toContain('Saved 1 file/directory to /Users/ruan')
        expect(restoredRows.join('\n')).toContain('after transfer')
        expect(restoredRows.join('\n')).toContain('shell$ ')
        expect(restoredRows.join('\n')).not.toMatch(/#(?:SUCC|CFG|NUM|NAME|SIZE|DATA|MD5|FAIL):/)
        expect(restoredRows.join('\n')).not.toContain('::TRZSZ:TRANSFER:')
    })

    it('blanks trzsz protocol rows in the restored normal screen without shifting later output', async () => {
        const frame = snapshot({
            scrollback: null,
            normalScreen:
                'trz -B 10K\n\n' +
                '    #SUCC:10240\n' +
                '       #SUCC:10240\n' +
                'Saved 1 file/directory to /Users/ruan\n' +
                '- 192.168.194.216.har.0\n' +
                'shell$ ',
            alternateScreen: null,
        })
        frame.state.alternateOn = false
        frame.state.rows = 8
        frame.state.columns = 120

        const terminal = await restore(frame)
        const restoredScreen = screen(terminal)

        expect(restoredScreen).toEqual([
            'trz -B 10K',
            '',
            '',
            '',
            'Saved 1 file/directory to /Users/ruan',
            '- 192.168.194.216.har.0',
            'shell$ ',
            '',
        ])
    })

    it('preserves a soft wrap across the scrollback/visible-screen boundary', async () => {
        const frame = snapshot({
            scrollback: 'abcde',
            normalScreen: 'fgh\nnext\n',
            alternateScreen: null,
            historyJoinsScreen: true,
        })
        frame.state.columns = 5
        frame.state.historySize = 1
        frame.state.alternateOn = false
        frame.state.wrapFlag = true
        const terminal = await restore(frame)
        expect(screen(terminal)).toEqual(['fgh', 'next', ''])
        expect(terminal.buffer.normal.baseY).toBe(1)
        expect(terminal.buffer.normal.getLine(1)?.isWrapped).toBe(true)
    })

    it('preserves normal-screen soft wraps without counting logical lines as rows', async () => {
        const frame = snapshot({ normalScreen: 'abcdefgh\nend\n', alternateScreen: null })
        frame.state.columns = 5
        frame.state.rows = 4
        frame.state.alternateOn = false
        frame.state.wrapFlag = true
        frame.state.cursorX = 0
        frame.state.cursorY = 3
        const terminal = await restore(frame)
        expect(screen(terminal)).toEqual(['abcde', 'fgh', 'end', ''])
        expect(terminal.buffer.normal.getLine(1)?.isWrapped).toBe(true)
        await write(terminal, 'next')
        expect(screen(terminal)).toEqual(['abcde', 'fgh', 'end', 'next'])
    })
})
