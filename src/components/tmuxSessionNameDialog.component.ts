import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { validateTmuxSessionName } from '../tmuxSessionName'

/**
 * Modal asking for the tmux session name before entering tmux mode.
 *
 * Opened through NgbModal (not as an in-tab overlay like the rename dialog),
 * because at this point the host is still Tabby's own terminal tab and the
 * plugin has no view of its own to draw into. Escape and backdrop clicks are
 * handled by NgbModal itself (keyboard/backdrop options); Enter submits the
 * form. The modal closes with the validated name, or is dismissed on cancel.
 */
@Component({
    selector: 'tmux-session-name-dialog',
    template: `
        <form (ngSubmit)="submit()">
            <div class="modal-header">
                <h5 class="modal-title" [id]="titleId">{{ title }}</h5>
            </div>
            <div class="modal-body">
                <label class="form-label" [attr.for]="inputId">{{ label }}</label>
                <input
                    #nameInput
                    [id]="inputId"
                    class="form-control"
                    type="text"
                    name="sessionName"
                    autocomplete="off"
                    spellcheck="false"
                    [(ngModel)]="draft"
                />
                <small class="form-text text-danger" *ngIf="showInvalidMessage">
                    {{ invalidMessage }}
                </small>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" (click)="cancel()">
                    {{ cancelLabel }}
                </button>
                <button type="submit" class="btn btn-primary" [disabled]="!isValid">
                    {{ confirmLabel }}
                </button>
            </div>
        </form>
    `,
})
export class TmuxSessionNameDialogComponent implements AfterViewInit {
    title = ''
    label = ''
    cancelLabel = ''
    confirmLabel = ''
    invalidMessage = ''
    /** Current input value; the opener prefills it with the configured default. */
    draft = ''

    @ViewChild('nameInput') private nameInput?: ElementRef<HTMLInputElement>

    readonly inputId = 'tmux-session-name-input'
    readonly titleId = 'tmux-session-name-title'

    constructor(private modal: NgbActiveModal) {}

    get isValid(): boolean {
        return validateTmuxSessionName(this.draft).error === null
    }

    /** Only characters are explained; an empty field just keeps Confirm disabled. */
    get showInvalidMessage(): boolean {
        return validateTmuxSessionName(this.draft).error === 'invalid'
    }

    ngAfterViewInit(): void {
        setTimeout(() => {
            this.nameInput?.nativeElement.focus()
            this.nameInput?.nativeElement.select()
        }, 0)
    }

    submit(): void {
        const { name } = validateTmuxSessionName(this.draft)
        if (name) {
            this.modal.close(name)
            return
        }
        this.nameInput?.nativeElement.focus()
    }

    cancel(): void {
        this.modal.dismiss()
    }
}
