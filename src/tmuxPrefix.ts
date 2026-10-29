/**
 * tmuxPrefix - tmux-style prefix key support (`prefix` + single key).
 *
 * Pure functions, no Angular / Tabby imports (the component specs mock
 * `tabby-core` with a short export list, so anything imported from it here
 * would break them). Used by TmuxSessionTabComponent (key interception and
 * action dispatch), TmuxPrefixOverlayComponent (key listing) and the settings
 * page (prefix recording, validation and conflict warning).
 *
 * Design: doc/PLAN_PREFIX_KEY.md. The prefix is intercepted at the plugin
 * level (capture-phase keydown on the session tab) and NEVER registered as a
 * Tabby hotkey, so it only ever acts inside tmux panes. The second key is
 * fixed to tmux's own bindings and dispatched straight to the plugin's action
 * methods — Tabby hotkey bindings are irrelevant to it.
 */

import type { TmuxTranslationKey } from './i18n'
import type { SplitDirection } from './tmuxKeymap'

export const DEFAULT_PREFIX_KEY = 'Ctrl-B'

export type PrefixOverlayStyle = 'bar' | 'modal'
export const DEFAULT_PREFIX_OVERLAY_STYLE: PrefixOverlayStyle = 'bar'
export const PREFIX_OVERLAY_STYLES: readonly PrefixOverlayStyle[] = ['bar', 'modal']

export type PrefixPlatform = 'darwin' | 'win32' | 'linux'

/** The subset of KeyboardEvent the prefix logic reads. */
export interface PrefixKeyEvent {
    key: string
    code: string
    ctrlKey: boolean
    altKey: boolean
    shiftKey: boolean
    metaKey: boolean
}

/**
 * Tabby's platform modifier names (hotkeys.util.ts). Mirrored here instead of
 * imported so the stored prefix string stays comparable with
 * `config.store.hotkeys` entries without depending on tabby-core at runtime.
 */
export function modifierNames(platform: PrefixPlatform): { meta: string; alt: string } {
    switch (platform) {
        case 'darwin':
            return { meta: '⌘', alt: '⌥' }
        case 'win32':
            return { meta: 'Win', alt: 'Alt' }
        default:
            return { meta: 'Super', alt: 'Alt' }
    }
}

export function currentPlatform(): PrefixPlatform {
    const platform = typeof process !== 'undefined' ? process.platform : 'linux'
    return platform === 'darwin' || platform === 'win32' ? platform : 'linux'
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

/** True for a keydown of a bare modifier (Ctrl, Shift, Alt, ⌘/Win). */
export function isModifierKey(key: string): boolean {
    return MODIFIER_KEYS.has(key)
}

const REGEX_LATIN_KEYNAME = /^[A-Za-z]$/
const CODE_KEY_NAMES: Record<string, string> = {
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    IntlBackslash: '`',
    Minus: '-',
    Equal: '=',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
}

/**
 * Name of the non-modifier key, following Tabby's getKeyName(): Latin
 * letters by reported character (Dvorak etc.), everything else by scancode.
 */
function keyNameFromEvent(event: PrefixKeyEvent): string {
    if (event.key === '`' || event.key === '~') {
        return event.key
    }
    if (REGEX_LATIN_KEYNAME.test(event.key)) {
        return event.key.toUpperCase()
    }
    const key = event.code.replace('Key', '').replace('Arrow', '').replace('Digit', '')
    return CODE_KEY_NAMES[key] ?? key
}

/**
 * Tabby-style keystroke name for a single keydown (`Ctrl-B`, `Ctrl-Shift-[`,
 * `⌥-Space`), built from the event's modifier flags in Tabby's strict order
 * (Ctrl, meta, alt, Shift). Returns null for a bare modifier keydown.
 */
export function keystrokeFromEvent(
    event: PrefixKeyEvent,
    platform: PrefixPlatform = currentPlatform(),
): string | null {
    if (isModifierKey(event.key)) {
        return null
    }
    const names = modifierNames(platform)
    const parts: string[] = []
    if (event.ctrlKey) parts.push('Ctrl')
    if (event.metaKey) parts.push(names.meta)
    if (event.altKey) parts.push(names.alt)
    if (event.shiftKey) parts.push('Shift')
    parts.push(keyNameFromEvent(event))
    return parts.join('-')
}

export function keystrokesEqual(
    a: string | null | undefined,
    b: string | null | undefined,
): boolean {
    if (!a || !b) return false
    return a.toLowerCase() === b.toLowerCase()
}

interface ParsedKeystroke {
    ctrl: boolean
    alt: boolean
    meta: boolean
    shift: boolean
    key: string
}

function parseKeystroke(keystroke: string, platform: PrefixPlatform): ParsedKeystroke | null {
    const parts = keystroke.split('-')
    // A trailing '-' key ("Ctrl--") splits into an empty last part.
    if (parts.length > 1 && parts[parts.length - 1] === '') {
        parts.pop()
        parts[parts.length - 1] = '-'
    }
    const key = parts.pop()
    if (!key) return null
    const names = modifierNames(platform)
    const parsed: ParsedKeystroke = { ctrl: false, alt: false, meta: false, shift: false, key }
    for (const part of parts) {
        if (part === 'Ctrl') parsed.ctrl = true
        else if (part === 'Shift') parsed.shift = true
        else if (part === names.alt) parsed.alt = true
        else if (part === names.meta) parsed.meta = true
        else return null
    }
    return parsed
}

/**
 * Bytes that `prefix prefix` (tmux send-prefix) writes to the pane: the raw
 * terminal encoding of the prefix key itself. Returns null when the key has
 * no terminal encoding (⌘/Win combos, function keys, ...) — such keys are
 * rejected as a prefix by isValidPrefixKey().
 */
export function encodePrefixKey(
    keystroke: string,
    platform: PrefixPlatform = currentPlatform(),
): Buffer | null {
    const parsed = parseKeystroke(keystroke, platform)
    if (!parsed || parsed.meta) return null
    const key = parsed.key
    let bytes: number[] | null = null
    if (parsed.ctrl) {
        if (REGEX_LATIN_KEYNAME.test(key)) {
            bytes = [key.toUpperCase().charCodeAt(0) & 0x1f]
        } else if (key === 'Space') {
            bytes = [0x00]
        } else if (key === '[') {
            bytes = [0x1b]
        } else if (key === '\\') {
            bytes = [0x1c]
        } else if (key === ']') {
            bytes = [0x1d]
        }
    } else if (parsed.alt) {
        if (REGEX_LATIN_KEYNAME.test(key)) {
            const char = parsed.shift ? key.toUpperCase() : key.toLowerCase()
            bytes = [char.charCodeAt(0)]
        } else if (key === 'Space') {
            bytes = [0x20]
        } else if (key.length === 1) {
            bytes = [key.charCodeAt(0)]
        }
    }
    if (!bytes) return null
    if (parsed.alt) {
        bytes = [0x1b, ...bytes]
    }
    return Buffer.from(bytes)
}

/**
 * A prefix must carry Ctrl or Alt (an unmodified key would fire while
 * typing) and must be encodable for send-prefix.
 */
export function isValidPrefixKey(
    keystroke: string | null | undefined,
    platform: PrefixPlatform = currentPlatform(),
): boolean {
    if (!keystroke) return false
    const parsed = parseKeystroke(keystroke, platform)
    if (!parsed || !(parsed.ctrl || parsed.alt)) return false
    return encodePrefixKey(keystroke, platform) !== null
}

/** Config value → usable prefix; anything invalid falls back to the default. */
export function normalizePrefixKey(
    value: unknown,
    platform: PrefixPlatform = currentPlatform(),
): string {
    return typeof value === 'string' && isValidPrefixKey(value, platform)
        ? value
        : DEFAULT_PREFIX_KEY
}

export function normalizePrefixOverlayStyle(value: unknown): PrefixOverlayStyle {
    return PREFIX_OVERLAY_STYLES.includes(value as PrefixOverlayStyle)
        ? (value as PrefixOverlayStyle)
        : DEFAULT_PREFIX_OVERLAY_STYLE
}

/**
 * Flatten Tabby's nested `hotkeys` config into `id → sequences`, mirroring
 * HotkeysService.getHotkeysConfigRecursive (nested objects join with '.',
 * a plain string is one single-stroke sequence).
 */
export function flattenHotkeysConfig(branch: unknown): Record<string, string[][]> {
    const result: Record<string, string[][]> = {}
    if (!branch || typeof branch !== 'object') return result
    for (const [key, raw] of Object.entries(branch as Record<string, unknown>)) {
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            for (const [subkey, sequences] of Object.entries(flattenHotkeysConfig(raw))) {
                result[`${key}.${subkey}`] = sequences
            }
            continue
        }
        const value = typeof raw === 'string' ? [raw] : raw
        if (!Array.isArray(value) || value.length === 0) continue
        result[key] = value
            .map((item) => (typeof item === 'string' ? [item] : item))
            .filter((item): item is string[] => Array.isArray(item))
    }
    return result
}

/**
 * Hotkey ids whose binding STARTS with the prefix keystroke. Inside a tmux
 * pane the prefix wins over them (capture-phase interception), so the
 * settings page warns about these.
 */
export function findPrefixConflicts(keystroke: string, hotkeysConfig: unknown): string[] {
    const flat = flattenHotkeysConfig(hotkeysConfig)
    return Object.keys(flat)
        .filter((id) => flat[id].some((sequence) => keystrokesEqual(sequence[0], keystroke)))
        .sort()
}

// ── Second key → action ──

export type PrefixAction =
    | { type: 'new-window' }
    | { type: 'next-window' }
    | { type: 'previous-window' }
    | { type: 'select-window'; index: number }
    | { type: 'rename-window' }
    | { type: 'kill-window' }
    | { type: 'split'; dir: Extract<SplitDirection, 'r' | 'b'> }
    | { type: 'navigate'; dir: SplitDirection }
    | { type: 'next-pane' }
    | { type: 'zoom' }
    | { type: 'kill-pane' }
    | { type: 'detach' }
    | { type: 'send-prefix' }

const ARROW_DIRECTIONS: Record<string, SplitDirection> = {
    ArrowLeft: 'l',
    ArrowRight: 'r',
    ArrowUp: 't',
    ArrowDown: 'b',
}

const SIMPLE_ACTIONS: Record<string, PrefixAction> = {
    c: { type: 'new-window' },
    n: { type: 'next-window' },
    p: { type: 'previous-window' },
    ',': { type: 'rename-window' },
    '&': { type: 'kill-window' },
    '%': { type: 'split', dir: 'r' },
    '"': { type: 'split', dir: 'b' },
    o: { type: 'next-pane' },
    z: { type: 'zoom' },
    x: { type: 'kill-pane' },
    d: { type: 'detach' },
}

/**
 * Resolve the key pressed after the prefix. Uses `event.key` (the produced
 * character) so `%` / `"` / `&` work on any layout. Letters are matched
 * exactly like tmux (`prefix X` is unbound, only `prefix x` kills the pane)
 * while a held Ctrl is ignored (`Ctrl-N` ≡ `n`, matching how most people
 * type `C-b C-n`). Alt/⌘ combos never match. Pressing the prefix again is
 * send-prefix. Returns null for an unsupported key.
 */
export function resolvePrefixAction(
    event: PrefixKeyEvent,
    prefixKey: string,
    platform: PrefixPlatform = currentPlatform(),
): PrefixAction | null {
    if (keystrokesEqual(keystrokeFromEvent(event, platform), prefixKey)) {
        return { type: 'send-prefix' }
    }
    if (event.altKey || event.metaKey) {
        return null
    }
    const arrow = ARROW_DIRECTIONS[event.key]
    if (arrow) {
        return { type: 'navigate', dir: arrow }
    }
    if (/^[0-9]$/.test(event.key)) {
        return { type: 'select-window', index: Number(event.key) }
    }
    return SIMPLE_ACTIONS[event.key] ?? null
}

// ── Overlay listing ──

export interface PrefixOverlayEntry {
    /** Key label; null = the configured prefix key itself (send-prefix). */
    keys: string | null
    label: TmuxTranslationKey
}

export interface PrefixOverlayGroup {
    label: TmuxTranslationKey
    entries: PrefixOverlayEntry[]
}

/** Overlay content in display order; only actions the plugin implements. */
export const PREFIX_OVERLAY_GROUPS: readonly PrefixOverlayGroup[] = [
    {
        label: 'prefix.group.windows',
        entries: [
            { keys: 'c', label: 'prefix.newWindow' },
            { keys: 'n', label: 'prefix.nextWindow' },
            { keys: 'p', label: 'prefix.previousWindow' },
            { keys: '0-9', label: 'prefix.selectWindow' },
            { keys: ',', label: 'prefix.renameWindow' },
            { keys: '&', label: 'prefix.killWindow' },
        ],
    },
    {
        label: 'prefix.group.panes',
        entries: [
            { keys: '%', label: 'prefix.splitRight' },
            { keys: '"', label: 'prefix.splitBottom' },
            { keys: '← ↑ ↓ →', label: 'prefix.navigate' },
            { keys: 'o', label: 'prefix.nextPane' },
            { keys: 'z', label: 'prefix.zoom' },
            { keys: 'x', label: 'prefix.killPane' },
        ],
    },
    {
        label: 'prefix.group.session',
        entries: [
            { keys: 'd', label: 'prefix.detach' },
            { keys: null, label: 'prefix.sendPrefix' },
        ],
    },
]
