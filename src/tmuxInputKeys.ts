/**
 * tmuxInputKeys - Translate terminal key sequences into tmux key names.
 *
 * Pure functions, no side effects. Used by TmuxGateway.sendKeys.
 *
 * In TUI tmux the client decodes the key sequences it receives from the outer
 * terminal (xterm.js here) into key codes and re-encodes them for the pane
 * according to the pane's TERM and cursor-key mode. Control mode skips that
 * step: `send-keys -H` writes the raw bytes into the pane unchanged.
 *
 * For most keys both encodings agree, but Home and End differ: xterm.js
 * sends `ESC [ H` / `ESC [ F` (or `ESC O H` / `ESC O F` in application
 * cursor mode) while tmux encodes them for a `tmux-256color` /
 * `screen-256color` pane as `ESC [ 1 ~` / `ESC [ 4 ~`, which is what
 * `$terminfo[khome]` / `$terminfo[kend]` resolve to inside the pane. A shell
 * that binds End through terminfo (zsh end-of-line, used to accept
 * zsh-autosuggestions) therefore never sees the raw xterm sequence.
 *
 * The fix is to hand such keys to tmux by name (`send-keys End`) and let it
 * encode them exactly as it does for a real client. Only a complete, single
 * key sequence is translated; anything else (typed text, pasted text,
 * mouse reports, unknown sequences) keeps the literal `-H` path.
 */

/** Final bytes / `~` numbers that tmux encodes differently from xterm.js. */
const FINAL_BYTE_KEYS: Readonly<Record<string, string>> = {
    H: 'Home',
    F: 'End',
}

const TILDE_NUMBER_KEYS: Readonly<Record<string, string>> = {
    '1': 'Home',
    '7': 'Home',
    '4': 'End',
    '8': 'End',
}

/**
 * Build the tmux modifier prefix for an xterm modifier parameter
 * (`1 + Shift·1 + Alt·2 + Ctrl·4`, so 2..8). Returns null for anything else
 * (Meta and other bits that tmux has no key name for).
 */
function modifierPrefix(param: string | undefined): string | null {
    if (param === undefined) return ''
    const value = Number(param)
    if (!Number.isInteger(value) || value < 2 || value > 8) return null
    const bits = value - 1
    let prefix = ''
    if (bits & 4) prefix += 'C-'
    if (bits & 2) prefix += 'M-'
    if (bits & 1) prefix += 'S-'
    return prefix
}

/**
 * Return the tmux key name for `data` when it is exactly one key sequence
 * that tmux must re-encode for the pane, otherwise null.
 *
 * Recognized forms (`m` = optional xterm modifier parameter):
 * - `ESC [ H`, `ESC [ F`, `ESC [ 1 ; m H`, `ESC [ 1 ; m F`
 * - `ESC O H`, `ESC O F`
 * - `ESC [ 1 ~`, `ESC [ 4 ~`, `ESC [ 7 ~`, `ESC [ 8 ~`, `ESC [ n ; m ~`
 */
export function tmuxKeyNameForSequence(data: Buffer): string | null {
    // Longest candidate is ESC [ 1 ; 8 F / ESC [ 1 ; 8 ~ (6 bytes).
    if (data.length < 3 || data.length > 6 || data[0] !== 0x1b) return null
    const text = data.toString('latin1')

    const ss3 = /^\x1bO([HF])$/.exec(text)
    if (ss3) return FINAL_BYTE_KEYS[ss3[1]]

    const csi = /^\x1b\[(?:1;(\d))?([HF])$/.exec(text)
    if (csi) {
        const prefix = modifierPrefix(csi[1])
        return prefix === null ? null : prefix + FINAL_BYTE_KEYS[csi[2]]
    }

    const tilde = /^\x1b\[([1478])(?:;(\d))?~$/.exec(text)
    if (tilde) {
        const prefix = modifierPrefix(tilde[2])
        return prefix === null ? null : prefix + TILDE_NUMBER_KEYS[tilde[1]]
    }

    return null
}
