import { describe, expect, it, vi } from 'vitest'

import { DomFocusable, guardDomFocus } from './paneDomFocus'

function makeTerminal() {
    const focus = vi.fn()
    return { focus, terminal: { focus } }
}

describe('guardDomFocus', () => {
    it('lets focus() through while the predicate holds', () => {
        const { focus, terminal } = makeTerminal()
        expect(guardDomFocus(terminal, () => true)).toBe(true)

        terminal.focus()

        expect(focus).toHaveBeenCalledTimes(1)
    })

    it('drops focus() while the predicate is false (hidden session tab)', () => {
        const { focus, terminal } = makeTerminal()
        guardDomFocus(terminal, () => false)

        terminal.focus()

        expect(focus).not.toHaveBeenCalled()
    })

    it('re-evaluates the predicate on every call (tab switched back)', () => {
        const { focus, terminal } = makeTerminal()
        let active = false
        guardDomFocus(terminal, () => active)

        terminal.focus()
        active = true
        terminal.focus()

        expect(focus).toHaveBeenCalledTimes(1)
    })

    it('calls the native focus with the terminal as `this`', () => {
        const seen: unknown[] = []
        const terminal = {
            focus(this: unknown) {
                seen.push(this)
            },
        }
        guardDomFocus(terminal, () => true)

        terminal.focus()

        expect(seen).toEqual([terminal])
    })

    it('catches a focus() reference captured before the guard was installed', () => {
        // XTermFrontend.focus() defers via setTimeout(() => this.xterm.focus()):
        // the property lookup happens when the timer fires, so a guard
        // installed in between must still apply.
        const { focus, terminal } = makeTerminal()
        const deferred = () => terminal.focus()
        guardDomFocus(terminal, () => false)

        deferred()

        expect(focus).not.toHaveBeenCalled()
    })

    it('is idempotent: a second guard is not installed', () => {
        const { focus, terminal } = makeTerminal()
        const first = vi.fn(() => true)
        const second = vi.fn(() => false)
        guardDomFocus(terminal, first)

        expect(guardDomFocus(terminal, second)).toBe(false)
        terminal.focus()

        expect(first).toHaveBeenCalledTimes(1)
        expect(second).not.toHaveBeenCalled()
        expect(focus).toHaveBeenCalledTimes(1)
    })

    it('tolerates a missing terminal', () => {
        expect(guardDomFocus(null, () => true)).toBe(false)
        expect(guardDomFocus(undefined, () => true)).toBe(false)
        expect(guardDomFocus({} as unknown as DomFocusable, () => true)).toBe(false)
    })
})
