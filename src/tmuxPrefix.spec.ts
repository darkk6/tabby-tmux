import { describe, expect, it } from 'vitest'
import {
    DEFAULT_PREFIX_KEY,
    PREFIX_OVERLAY_GROUPS,
    PrefixKeyEvent,
    encodePrefixKey,
    findPrefixConflicts,
    flattenHotkeysConfig,
    isModifierKey,
    isValidPrefixKey,
    keystrokeFromEvent,
    normalizePrefixKey,
    normalizePrefixOverlayStyle,
    resolvePrefixAction,
} from './tmuxPrefix'

function key(partial: Partial<PrefixKeyEvent> & { key: string }): PrefixKeyEvent {
    return {
        code: partial.code ?? `Key${partial.key.toUpperCase()}`,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ...partial,
    }
}

describe('keystrokeFromEvent', () => {
    it('names a Ctrl + letter stroke the way Tabby does', () => {
        expect(keystrokeFromEvent(key({ key: 'b', ctrlKey: true }), 'win32')).toBe('Ctrl-B')
    })

    it('orders modifiers Ctrl, meta, alt, Shift', () => {
        const event = key({ key: 'b', ctrlKey: true, altKey: true, shiftKey: true, metaKey: true })
        expect(keystrokeFromEvent(event, 'win32')).toBe('Ctrl-Win-Alt-Shift-B')
        expect(keystrokeFromEvent(event, 'darwin')).toBe('Ctrl-⌘-⌥-Shift-B')
        expect(keystrokeFromEvent(event, 'linux')).toBe('Ctrl-Super-Alt-Shift-B')
    })

    it('names non-letter keys from the scancode like Tabby', () => {
        expect(
            keystrokeFromEvent(key({ key: '[', code: 'BracketLeft', ctrlKey: true }), 'win32'),
        ).toBe('Ctrl-[')
        expect(keystrokeFromEvent(key({ key: ' ', code: 'Space', ctrlKey: true }), 'win32')).toBe(
            'Ctrl-Space',
        )
        expect(keystrokeFromEvent(key({ key: '%', code: 'Digit5', shiftKey: true }), 'win32')).toBe(
            'Shift-5',
        )
    })

    it('uses the reported character for letters under a macOS Option combo', () => {
        // Option-B produces '∫' on macOS; Tabby falls back to the scancode.
        expect(keystrokeFromEvent(key({ key: '∫', code: 'KeyB', altKey: true }), 'darwin')).toBe(
            '⌥-B',
        )
    })

    it('returns null for a bare modifier keydown', () => {
        expect(
            keystrokeFromEvent(key({ key: 'Control', code: 'ControlLeft', ctrlKey: true })),
        ).toBe(null)
        expect(isModifierKey('Shift')).toBe(true)
        expect(isModifierKey('b')).toBe(false)
    })
})

describe('encodePrefixKey / isValidPrefixKey', () => {
    it.each([
        ['Ctrl-B', [0x02]],
        ['Ctrl-A', [0x01]],
        ['Ctrl-Shift-A', [0x01]],
        ['Ctrl-Space', [0x00]],
        ['Ctrl-[', [0x1b]],
        ['Alt-B', [0x1b, 0x62]],
        ['Alt-Shift-B', [0x1b, 0x42]],
        ['Ctrl-Alt-B', [0x1b, 0x02]],
    ])('encodes %s', (keystroke, bytes) => {
        expect([...(encodePrefixKey(keystroke, 'win32') ?? [])]).toEqual(bytes)
        expect(isValidPrefixKey(keystroke, 'win32')).toBe(true)
    })

    it('encodes macOS modifier names', () => {
        expect([...(encodePrefixKey('⌥-B', 'darwin') ?? [])]).toEqual([0x1b, 0x62])
    })

    it.each(['B', 'Shift-B', 'Win-B', '⌘-B', 'Ctrl-F1', 'Ctrl-Win-B', '', 'Bogus-B'])(
        'rejects %s as a prefix',
        (keystroke) => {
            expect(isValidPrefixKey(keystroke, keystroke.includes('⌘') ? 'darwin' : 'win32')).toBe(
                false,
            )
        },
    )

    it('normalizes invalid config values to the default', () => {
        expect(normalizePrefixKey('Ctrl-A', 'win32')).toBe('Ctrl-A')
        expect(normalizePrefixKey('B', 'win32')).toBe(DEFAULT_PREFIX_KEY)
        expect(normalizePrefixKey(undefined, 'win32')).toBe(DEFAULT_PREFIX_KEY)
        expect(normalizePrefixKey(42, 'win32')).toBe(DEFAULT_PREFIX_KEY)
    })
})

describe('normalizePrefixOverlayStyle', () => {
    it('accepts the known styles and falls back to bar', () => {
        expect(normalizePrefixOverlayStyle('modal')).toBe('modal')
        expect(normalizePrefixOverlayStyle('bar')).toBe('bar')
        expect(normalizePrefixOverlayStyle('popup')).toBe('bar')
        expect(normalizePrefixOverlayStyle(undefined)).toBe('bar')
    })
})

describe('flattenHotkeysConfig / findPrefixConflicts', () => {
    const hotkeys = {
        'close-tab': ['Ctrl-Shift-W'],
        'rename-tab': 'Ctrl-Shift-R',
        'toggle-last-tab': [],
        chord: [['Ctrl-B', 'C']],
        tmuxPlugin: {
            'new-window': ['Ctrl-Shift-B'],
            'toggle-tmux-mode': ['Ctrl-Shift-X', 'Ctrl-B'],
        },
    }

    it('flattens nested ids and normalizes strings to sequences', () => {
        expect(flattenHotkeysConfig(hotkeys)).toEqual({
            'close-tab': [['Ctrl-Shift-W']],
            'rename-tab': [['Ctrl-Shift-R']],
            chord: [['Ctrl-B', 'C']],
            'tmuxPlugin.new-window': [['Ctrl-Shift-B']],
            'tmuxPlugin.toggle-tmux-mode': [['Ctrl-Shift-X'], ['Ctrl-B']],
        })
    })

    it('reports ids whose binding starts with the prefix, case-insensitively', () => {
        expect(findPrefixConflicts('ctrl-b', hotkeys)).toEqual([
            'chord',
            'tmuxPlugin.toggle-tmux-mode',
        ])
        expect(findPrefixConflicts('Ctrl-A', hotkeys)).toEqual([])
        expect(findPrefixConflicts('Ctrl-A', undefined)).toEqual([])
    })
})

describe('resolvePrefixAction', () => {
    const prefix = 'Ctrl-B'

    it.each([
        ['c', { type: 'new-window' }],
        ['n', { type: 'next-window' }],
        ['p', { type: 'previous-window' }],
        [',', { type: 'rename-window' }],
        ['&', { type: 'kill-window' }],
        ['%', { type: 'split', dir: 'r' }],
        ['"', { type: 'split', dir: 'b' }],
        ['o', { type: 'next-pane' }],
        ['z', { type: 'zoom' }],
        ['x', { type: 'kill-pane' }],
        ['d', { type: 'detach' }],
    ])('maps %s', (pressed, expected) => {
        expect(resolvePrefixAction(key({ key: pressed, code: 'KeyX' }), prefix, 'win32')).toEqual(
            expected,
        )
    })

    it('maps digits to the tmux window index', () => {
        expect(resolvePrefixAction(key({ key: '0', code: 'Digit0' }), prefix, 'win32')).toEqual({
            type: 'select-window',
            index: 0,
        })
        expect(resolvePrefixAction(key({ key: '7', code: 'Numpad7' }), prefix, 'win32')).toEqual({
            type: 'select-window',
            index: 7,
        })
    })

    it('maps arrows to pane navigation', () => {
        expect(
            resolvePrefixAction(key({ key: 'ArrowLeft', code: 'ArrowLeft' }), prefix, 'win32'),
        ).toEqual({ type: 'navigate', dir: 'l' })
        expect(
            resolvePrefixAction(key({ key: 'ArrowDown', code: 'ArrowDown' }), prefix, 'win32'),
        ).toEqual({ type: 'navigate', dir: 'b' })
    })

    it('ignores a held Ctrl but matches letters case-sensitively like tmux', () => {
        expect(resolvePrefixAction(key({ key: 'n', ctrlKey: true }), prefix, 'win32')).toEqual({
            type: 'next-window',
        })
        // tmux: `prefix N` / `prefix X` are unbound — never kill a pane on a
        // stray Ctrl-Shift-X typed while the prefix is pending.
        expect(resolvePrefixAction(key({ key: 'N', shiftKey: true }), prefix, 'win32')).toBe(null)
        expect(resolvePrefixAction(key({ key: 'X', shiftKey: true }), prefix, 'win32')).toBe(null)
    })

    it('returns send-prefix when the prefix is pressed again, for any prefix', () => {
        expect(resolvePrefixAction(key({ key: 'b', ctrlKey: true }), prefix, 'win32')).toEqual({
            type: 'send-prefix',
        })
        expect(resolvePrefixAction(key({ key: 'a', ctrlKey: true }), 'Ctrl-A', 'win32')).toEqual({
            type: 'send-prefix',
        })
        // Ctrl-A is not the prefix here, so it is a plain unsupported key.
        expect(resolvePrefixAction(key({ key: 'a', ctrlKey: true }), prefix, 'win32')).toBe(null)
    })

    it('returns null for unsupported keys and Alt/meta combos', () => {
        expect(resolvePrefixAction(key({ key: 'q' }), prefix, 'win32')).toBe(null)
        expect(resolvePrefixAction(key({ key: 'Escape', code: 'Escape' }), prefix, 'win32')).toBe(
            null,
        )
        expect(resolvePrefixAction(key({ key: 'c', altKey: true }), prefix, 'win32')).toBe(null)
        expect(resolvePrefixAction(key({ key: 'c', metaKey: true }), prefix, 'win32')).toBe(null)
    })
})

describe('PREFIX_OVERLAY_GROUPS', () => {
    it('lists every dispatchable key exactly once plus send-prefix', () => {
        const keys = PREFIX_OVERLAY_GROUPS.flatMap((group) => group.entries.map((e) => e.keys))
        expect(keys.filter((k) => k === null)).toHaveLength(1)
        const listed = keys.filter((k): k is string => k !== null)
        expect(new Set(listed).size).toBe(listed.length)
        for (const single of ['c', 'n', 'p', ',', '&', '%', '"', 'o', 'z', 'x', 'd']) {
            expect(listed).toContain(single)
        }
    })
})
