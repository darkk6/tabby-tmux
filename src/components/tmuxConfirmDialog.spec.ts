import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { TmuxConfirmDialogComponent } from './tmuxConfirmDialog.component'

const COMPONENT_SOURCE = readFileSync(resolve(__dirname, 'tmuxConfirmDialog.component.ts'), 'utf8')

describe('TmuxConfirmDialogComponent', () => {
    it('focuses the confirm button after the view settles, so Enter confirms', () => {
        vi.useFakeTimers()
        try {
            const component = new TmuxConfirmDialogComponent()
            const focus = vi.fn()
            ;(component as unknown as { confirmButton: unknown }).confirmButton = {
                nativeElement: { focus },
            }
            component.ngAfterViewInit()
            expect(focus).not.toHaveBeenCalled()
            vi.runAllTimers()
            expect(focus).toHaveBeenCalledTimes(1)
        } finally {
            vi.useRealTimers()
        }
    })

    it('survives a missing button reference', () => {
        vi.useFakeTimers()
        try {
            const component = new TmuxConfirmDialogComponent()
            component.ngAfterViewInit()
            expect(() => vi.runAllTimers()).not.toThrow()
        } finally {
            vi.useRealTimers()
        }
    })

    it('wires Escape, the backdrop and the buttons to cancel / confirm', () => {
        // Template contract: the handlers are inline, so assert the bindings.
        expect(COMPONENT_SOURCE).toContain('(keydown.escape)="cancel.emit()"')
        expect(COMPONENT_SOURCE).toMatch(
            /class="confirm-dialog-backdrop"[\s\S]*?\(click\)="cancel\.emit\(\)"/,
        )
        expect(COMPONENT_SOURCE).toContain('(click)="confirm.emit()"')
        // Keys typed into the dialog must not reach the pane area listener:
        // the dialog is rendered as a sibling of .pane-area by the session tab.
        expect(COMPONENT_SOURCE).toContain('sibling of the pane area')
    })
})
