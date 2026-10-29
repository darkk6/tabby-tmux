import { describe, expect, it, vi } from 'vitest'
import type { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { TmuxSessionNameDialogComponent } from './tmuxSessionNameDialog.component'

// ng-bootstrap is an Angular partially-compiled package; stub the modal handle.
vi.mock('@ng-bootstrap/ng-bootstrap', () => ({ NgbActiveModal: class {} }))

function createDialog() {
    const modal = { close: vi.fn(), dismiss: vi.fn() }
    const dialog = new TmuxSessionNameDialogComponent(modal as unknown as NgbActiveModal)
    return { dialog, modal }
}

describe('TmuxSessionNameDialogComponent', () => {
    it('closes the modal with the trimmed name on submit', () => {
        const { dialog, modal } = createDialog()
        dialog.draft = '  work '

        dialog.submit()

        expect(modal.close).toHaveBeenCalledExactlyOnceWith('work')
        expect(modal.dismiss).not.toHaveBeenCalled()
    })

    it('keeps the modal open when the name is empty', () => {
        const { dialog, modal } = createDialog()
        dialog.draft = '   '

        dialog.submit()

        expect(dialog.isValid).toBe(false)
        expect(dialog.showInvalidMessage).toBe(false)
        expect(modal.close).not.toHaveBeenCalled()
    })

    it('explains invalid characters and refuses to submit them', () => {
        const { dialog, modal } = createDialog()
        dialog.draft = 'my session'

        dialog.submit()

        expect(dialog.isValid).toBe(false)
        expect(dialog.showInvalidMessage).toBe(true)
        expect(modal.close).not.toHaveBeenCalled()
    })

    it('dismisses the modal on cancel', () => {
        const { dialog, modal } = createDialog()

        dialog.cancel()

        expect(modal.dismiss).toHaveBeenCalledOnce()
        expect(modal.close).not.toHaveBeenCalled()
    })
})
