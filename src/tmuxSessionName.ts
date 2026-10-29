/**
 * Session name handling for "Enter Tmux Mode".
 *
 * The name is typed by the user, then sent through the host shell as
 * `tmux -CC new -A -s <name>`. tmux itself rejects session names that are
 * empty or contain `.` or `:`; whitespace would split the shell argument and
 * a trailing `;` is treated by tmux as a command separator even when the
 * shell passed it as one token. All of those are rejected up front so the
 * dialog can explain the problem instead of the shell failing silently.
 */

export type TmuxSessionNameError = 'empty' | 'invalid'

export interface TmuxSessionNameValidation {
    /** Trimmed name when valid, otherwise null. */
    name: string | null
    error: TmuxSessionNameError | null
}

const INVALID_SESSION_NAME_CHARS = /[\s.:;]/

export function validateTmuxSessionName(
    value: string | null | undefined,
): TmuxSessionNameValidation {
    const name = (value ?? '').trim()
    if (!name) {
        return { name: null, error: 'empty' }
    }
    if (INVALID_SESSION_NAME_CHARS.test(name)) {
        return { name: null, error: 'invalid' }
    }
    return { name, error: null }
}

const SAFE_SHELL_WORD = /^[A-Za-z0-9_@%+=,./-]+$/

/**
 * Quote one argument for a POSIX shell. Plain words are left untouched so the
 * common case produces exactly the command the plugin has always sent.
 */
export function quoteShellArgument(value: string): string {
    if (SAFE_SHELL_WORD.test(value)) {
        return value
    }
    return `'${value.replace(/'/g, `'\\''`)}'`
}

/** The shell command that starts (or re-attaches) a control-mode session. */
export function buildTmuxAttachCommand(sessionName: string): string {
    return `tmux -CC new -A -s ${quoteShellArgument(sessionName)}`
}
