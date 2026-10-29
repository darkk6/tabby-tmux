import {
    AfterViewInit,
    Component,
    ElementRef,
    EventEmitter,
    Input,
    Output,
    ViewChild,
} from '@angular/core'

/**
 * TmuxConfirmDialogComponent - inline yes/no dialog for destructive prefix
 * actions (`prefix x` kill-pane, `prefix &` kill-window), mirroring tmux's
 * own `confirm-before` prompts. Same inline-overlay pattern as the rename
 * dialog: rendered by the session tab as a sibling of the pane area, so the
 * prefix key listener (which only acts inside the pane area) ignores keys
 * typed while it is open.
 */
@Component({
    selector: 'tmux-confirm-dialog',
    template: `
        <div
            class="confirm-dialog-backdrop"
            role="presentation"
            (mousedown)="$event.stopPropagation()"
            (click)="cancel.emit()"
        >
            <div
                class="confirm-dialog"
                role="alertdialog"
                aria-modal="true"
                [attr.aria-labelledby]="titleId"
                (mousedown)="$event.stopPropagation()"
                (click)="$event.stopPropagation()"
                (keydown.escape)="cancel.emit()"
            >
                <h4 [id]="titleId">{{ message }}</h4>
                <div class="confirm-dialog-actions">
                    <button type="button" class="btn btn-secondary" (click)="cancel.emit()">
                        {{ cancelLabel }}
                    </button>
                    <button
                        #confirmButton
                        type="button"
                        class="btn btn-danger"
                        (click)="confirm.emit()"
                    >
                        {{ confirmLabel }}
                    </button>
                </div>
            </div>
        </div>
    `,
    styles: [
        `
            :host {
                position: absolute;
                inset: 0;
                z-index: 100;
                display: block;
            }
            .confirm-dialog-backdrop {
                position: absolute;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 16px;
                background: rgba(0, 0, 0, 0.45);
                box-sizing: border-box;
            }
            .confirm-dialog {
                width: min(420px, 100%);
                padding: 18px;
                border: 1px solid var(--theme-bg-less-2, rgba(255, 255, 255, 0.18));
                border-radius: 5px;
                background: var(--theme-bg-more-2, #252525);
                color: var(--theme-fg, #fff);
                box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
            }
            .confirm-dialog h4 {
                margin: 0;
                font-size: 1rem;
                font-weight: 500;
                overflow-wrap: anywhere;
            }
            .confirm-dialog-actions {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
                margin-top: 16px;
            }
        `,
    ],
})
export class TmuxConfirmDialogComponent implements AfterViewInit {
    @Input() message = ''
    @Input() cancelLabel = ''
    @Input() confirmLabel = ''

    @Output() confirm = new EventEmitter<void>()
    @Output() cancel = new EventEmitter<void>()

    @ViewChild('confirmButton') private confirmButton?: ElementRef<HTMLButtonElement>

    readonly titleId = 'tmux-confirm-title'

    ngAfterViewInit(): void {
        // Enter confirms (focused button), Esc cancels (keydown.escape above).
        setTimeout(() => this.confirmButton?.nativeElement.focus(), 0)
    }
}
