export const DEFAULT_HISTORY_RESTORE_LIMIT = 5000
// capture-pane converts row offsets to signed 32-bit integers.
export const MAX_HISTORY_RESTORE_LIMIT = 0x7fffffff

/** Accept only nonnegative row counts that tmux can represent without truncation. */
export function normalizeHistoryRestoreLimit(value: unknown): number {
    return typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= MAX_HISTORY_RESTORE_LIMIT
        ? value
        : DEFAULT_HISTORY_RESTORE_LIMIT
}
