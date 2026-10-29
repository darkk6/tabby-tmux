import { Injectable, NgZone } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { TmuxI18nService } from './tmuxI18n.service'
import { TmuxSessionNameDialogComponent } from '../components/tmuxSessionNameDialog.component'

/**
 * Asks the user which tmux session to attach to before entering tmux mode.
 *
 * Both entry points (tab context menu and the toggle hotkey) end up here.
 * While a prompt is open, further requests are ignored instead of stacking a
 * second modal or resetting what the user has typed.
 */
@Injectable({ providedIn: 'root' })
export class TmuxSessionNamePromptService {
    private pending: Promise<string | null> | null = null

    constructor(
        private ngbModal: NgbModal,
        private configService: ConfigService,
        private i18n: TmuxI18nService,
        private zone: NgZone,
    ) {}

    get isOpen(): boolean {
        return this.pending !== null
    }

    /**
     * Resolves with the validated session name, or null when the user
     * cancelled (Escape, backdrop click, Cancel) or a prompt is already open.
     */
    async prompt(): Promise<string | null> {
        if (this.pending) {
            return null
        }

        // Open inside the Angular zone: the hotkey path may arrive from a
        // listener outside it, and the modal only renders on change detection.
        const modalRef = this.zone.run(() =>
            this.ngbModal.open(TmuxSessionNameDialogComponent, {
                backdrop: true,
                keyboard: true,
                centered: true,
            }),
        )
        const dialog = modalRef.componentInstance as TmuxSessionNameDialogComponent
        dialog.title = this.i18n.t('mode.enter')
        dialog.label = this.i18n.t('sessionName.label')
        dialog.invalidMessage = this.i18n.t('sessionName.invalid')
        dialog.cancelLabel = this.i18n.t('common.cancel')
        dialog.confirmLabel = this.i18n.t('common.confirm')
        dialog.draft = this.configService.store?.tmuxPlugin?.defaultSessionName ?? 'default'

        this.pending = modalRef.result.then(
            (value) => (typeof value === 'string' && value ? value : null),
            () => null,
        )
        try {
            return await this.pending
        } finally {
            this.pending = null
        }
    }
}
