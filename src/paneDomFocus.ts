/**
 * paneDomFocus - keep a pane's xterm DOM focus inside Tabby's active tab.
 *
 * Every pane tab is a BaseTerminalTabComponent, and that base focuses the
 * xterm textarea (frontend.focus() → xterm.focus()) on every focused$ event
 * and once more unconditionally in ngOnInit. The session tab re-emits those
 * events whenever tmux reports a change — %layout-change, %window-pane-changed
 * — regardless of whether the session tab is the tab the user is looking at.
 *
 * Tabby hides inactive tab bodies with `left: -1000%`, not `display: none`,
 * so a hidden textarea is still focusable: a layout change made from ANOTHER
 * client of the same tmux session (e.g. `prefix + Space` in a plain `tmux
 * attach` running in a different Tabby tab) silently yanked the keyboard
 * focus into the hidden tmux-mode tab. Keystrokes then went to the hidden
 * pane — ordinary text still reached the shared pane via send-keys and
 * looked normal, but the prefix was swallowed by the tmux-mode tab's own
 * prefix handling — until the user clicked back into their tab.
 *
 * The guard wraps the focus method of the terminal (the xterm instance, so
 * the deferred focus the base class schedules before the guard exists is
 * caught too) and only lets it through while `canFocus()` holds: the
 * owning session tab is Tabby's active tab. When the user switches back,
 * Tabby emits focused$ on the session tab, SplitTabComponent re-focuses the
 * active pane and the guard lets that one through, so focus is restored.
 */

/** Anything with an xterm-style `focus()` — the xterm Terminal in practice. */
export interface DomFocusable {
    focus(): void
}

const GUARD_MARK = Symbol('tmuxDomFocusGuard')

/**
 * Wrap `target.focus()` so it is a no-op while `canFocus()` is false.
 *
 * Idempotent: a target that is already guarded is left alone (returns
 * false). Safe to call with a missing target (returns false).
 */
export function guardDomFocus(
    target: DomFocusable | null | undefined,
    canFocus: () => boolean,
): boolean {
    if (!target || typeof target.focus !== 'function') {
        return false
    }
    const marked = target as DomFocusable & { [GUARD_MARK]?: true }
    if (marked[GUARD_MARK]) {
        return false
    }
    const nativeFocus = target.focus
    target.focus = function guardedFocus(this: DomFocusable): void {
        if (!canFocus()) {
            return
        }
        nativeFocus.call(this)
    }
    marked[GUARD_MARK] = true
    return true
}
