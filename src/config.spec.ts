import { describe, expect, it, vi } from 'vitest'
import { TmuxConfigProvider } from './config'
import { MAX_HISTORY_RESTORE_LIMIT, normalizeHistoryRestoreLimit } from './historyRestore'

// tabby-core is an Angular partially-compiled package; loading it in Node
// requires the Angular linker/JIT compiler, so stub ConfigProvider instead.
vi.mock('tabby-core', () => ({
    ConfigProvider: class {
        defaults: Record<string, unknown> = {}
    },
}))

describe('TmuxConfigProvider', () => {
    it.each([0, 1, 5000, 100000, MAX_HISTORY_RESTORE_LIMIT])(
        'accepts a history restore limit of %s',
        (value) => {
            expect(normalizeHistoryRestoreLimit(value)).toBe(value)
        },
    )

    it.each([
        undefined,
        null,
        -1,
        1.5,
        NaN,
        Infinity,
        MAX_HISTORY_RESTORE_LIMIT + 1,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER + 1,
        '1; kill-server',
    ])('falls back to 5000 for an invalid history limit: %s', (value) =>
        expect(normalizeHistoryRestoreLimit(value)).toBe(5000),
    )
    it('provides the expected tmuxPlugin defaults', () => {
        const provider = new TmuxConfigProvider()
        expect(provider.defaults.tmuxPlugin).toEqual({
            defaultSessionName: 'default',
            sessionTitleFormat: '#{window_name} - #{host}',
            historyRestoreLimit: 5000,
            commandTimeoutMs: 30_000,
            sendKeysChunkSize: 200,
            resizeDebounceMs: 150,
            debugLogging: false,
            showWindowCloseButton: true,
        })
    })

    it('provides nested tmuxPlugin hotkey defaults for window actions', () => {
        const provider = new TmuxConfigProvider()
        const hotkeys = provider.defaults.hotkeys
        // Tabby's getHotkeysConfigRecursive flattens nested config into
        // dot-prefixed ids, so `hotkeys.tmuxPlugin.next-window` matches the
        // `tmuxPlugin.next-window` HotkeyDescription id.
        expect(hotkeys.tmuxPlugin).toEqual({
            'previous-window': ['Ctrl-Shift-['],
            'next-window': ['Ctrl-Shift-]'],
            'window-1': ['Ctrl-Shift-1'],
            'window-2': ['Ctrl-Shift-2'],
            'window-3': ['Ctrl-Shift-3'],
            'window-4': ['Ctrl-Shift-4'],
            'window-5': ['Ctrl-Shift-5'],
            'window-6': ['Ctrl-Shift-6'],
            'window-7': ['Ctrl-Shift-7'],
            'window-8': ['Ctrl-Shift-8'],
            'window-9': ['Ctrl-Shift-9'],
            'new-window': ['Ctrl-Shift-B'],
            'toggle-tmux-mode': ['Ctrl-Shift-X'],
        })
    })
})
