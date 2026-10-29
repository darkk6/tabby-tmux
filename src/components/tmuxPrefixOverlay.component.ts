import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output } from '@angular/core'
import { Subscription } from 'rxjs'
import { TmuxI18nService } from '../services/tmuxI18n.service'
import { PREFIX_OVERLAY_GROUPS, PrefixOverlayStyle } from '../tmuxPrefix'

interface OverlayRow {
    keys: string
    label: string
}

interface OverlayGroup {
    label: string
    rows: OverlayRow[]
}

/**
 * TmuxPrefixOverlayComponent - "which-key" listing shown while the session
 * tab waits for the key after the tmux prefix (doc/PLAN_PREFIX_KEY.md).
 *
 * Two variants, picked by `tmuxPlugin.prefixOverlayStyle` (both are kept):
 * - `bar`: a strip pinned to the bottom of the pane area. It overlays the
 *   bottom rows instead of taking layout space — pushing the panes up would
 *   shrink the pane area, fire refresh-client and make tmux relayout every
 *   time the prefix is pressed.
 * - `modal`: a dimmed backdrop over the pane area with a centered card.
 *
 * Rendered INSIDE `.pane-area` so `inset: 0` covers exactly the panes and
 * never the window bar. Purely presentational: it never takes focus (the
 * second keystroke must keep targeting the pane's xterm) and only reports a
 * backdrop click through `dismiss`.
 */
@Component({
    selector: 'tmux-prefix-overlay',
    template: `
        <div
            class="prefix-overlay"
            [class.prefix-overlay-bar]="variant === 'bar'"
            [class.prefix-overlay-modal]="variant === 'modal'"
            role="presentation"
            (mousedown)="onBackdropMouseDown($event)"
        >
            <div class="prefix-card" role="status" aria-live="polite">
                <div class="prefix-header">
                    <span class="prefix-title">{{ title }}</span>
                    <span class="prefix-hint">{{ hint }}</span>
                </div>
                <div class="prefix-groups">
                    <section class="prefix-group" *ngFor="let group of groups">
                        <h5 class="prefix-group-title">{{ group.label }}</h5>
                        <div class="prefix-row" *ngFor="let row of group.rows">
                            <kbd class="prefix-key">{{ row.keys }}</kbd>
                            <span class="prefix-label">{{ row.label }}</span>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    `,
    styles: [
        `
            :host {
                position: absolute;
                inset: 0;
                /* above panes (z 1-2) and dividers (z 5), below dialogs (z 100) */
                z-index: 50;
                display: block;
                pointer-events: none;
            }
            .prefix-overlay {
                position: absolute;
                inset: 0;
                display: flex;
                color: var(--theme-fg, #eee);
                font-size: 12px;
                line-height: 1.4;
            }
            /* ── bar variant: strip pinned to the bottom edge ── */
            .prefix-overlay-bar {
                align-items: flex-end;
                justify-content: stretch;
            }
            .prefix-overlay-bar .prefix-card {
                pointer-events: auto;
                width: 100%;
                padding: 6px 12px 8px;
                box-sizing: border-box;
                background: var(--theme-bg-more-2, rgba(30, 30, 30, 0.95));
                border-top: 1px solid var(--theme-bg-less-2, rgba(255, 255, 255, 0.15));
                box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.35);
            }
            .prefix-overlay-bar .prefix-groups {
                display: flex;
                flex-wrap: wrap;
                gap: 4px 28px;
            }
            .prefix-overlay-bar .prefix-group {
                display: grid;
                grid-template-columns: auto auto;
                column-gap: 18px;
                row-gap: 2px;
                align-content: start;
            }
            .prefix-overlay-bar .prefix-group-title {
                grid-column: 1 / -1;
            }
            .prefix-overlay-bar .prefix-row {
                display: contents;
            }
            /* ── modal variant: dimmed backdrop + centered card ── */
            .prefix-overlay-modal {
                pointer-events: auto;
                align-items: center;
                justify-content: center;
                padding: 16px;
                background: rgba(0, 0, 0, 0.45);
                box-sizing: border-box;
            }
            /* Larger than the bar: it is the focus of the screen while open. */
            .prefix-overlay-modal .prefix-card {
                width: min(860px, 100%);
                max-height: 100%;
                overflow: auto;
                padding: 22px 28px 26px;
                box-sizing: border-box;
                border: 1px solid var(--theme-bg-less-2, rgba(255, 255, 255, 0.18));
                border-radius: 8px;
                background: var(--theme-bg-more-2, #252525);
                box-shadow: 0 10px 36px rgba(0, 0, 0, 0.5);
                font-size: 15px;
            }
            .prefix-overlay-modal .prefix-header {
                margin-bottom: 14px;
            }
            .prefix-overlay-modal .prefix-title {
                font-size: 17px;
            }
            .prefix-overlay-modal .prefix-groups {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
                gap: 14px 32px;
            }
            .prefix-overlay-modal .prefix-group-title {
                margin-bottom: 6px;
                font-size: 12px;
            }
            .prefix-overlay-modal .prefix-row {
                display: flex;
                align-items: baseline;
                gap: 12px;
                padding: 3px 0;
            }
            .prefix-overlay-modal .prefix-key {
                min-width: 2em;
                padding: 1px 8px;
                font-size: 14px;
            }
            /* ── shared ── */
            .prefix-header {
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                gap: 12px;
                margin-bottom: 6px;
            }
            .prefix-title {
                font-weight: 600;
            }
            .prefix-hint {
                opacity: 0.6;
                white-space: nowrap;
            }
            .prefix-group-title {
                margin: 0 0 2px;
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                opacity: 0.6;
            }
            /* Tabby's global kbd rule (Bootstrap) sets its own color/background,
               which left the key caps blank on the dark theme — pin both. */
            .prefix-key {
                display: inline-block;
                min-width: 1.6em;
                padding: 0 5px;
                border: 1px solid var(--theme-bg-less-2, rgba(255, 255, 255, 0.25));
                border-radius: 3px;
                background: rgba(255, 255, 255, 0.08);
                color: inherit;
                font-family: var(--font-family-monospace, monospace);
                font-size: 11px;
                font-weight: 600;
                line-height: 1.5;
                text-align: center;
                white-space: nowrap;
            }
            .prefix-label {
                white-space: nowrap;
            }
        `,
    ],
})
export class TmuxPrefixOverlayComponent implements OnChanges, OnDestroy {
    /** Configured prefix keystroke, shown in the title and the send-prefix row. */
    @Input() prefixKey = ''
    @Input() variant: PrefixOverlayStyle = 'bar'
    /** Backdrop click (modal variant) — the session tab cancels the prefix. */
    @Output() dismiss = new EventEmitter<void>()

    title = ''
    hint = ''
    groups: OverlayGroup[] = []

    private languageSubscription: Subscription

    constructor(private i18n: TmuxI18nService) {
        this.languageSubscription = this.i18n.languageChange$.subscribe(() => this.rebuild())
        this.rebuild()
    }

    ngOnChanges(): void {
        this.rebuild()
    }

    ngOnDestroy(): void {
        this.languageSubscription.unsubscribe()
    }

    onBackdropMouseDown(event: MouseEvent): void {
        // Only the modal backdrop is clickable (the bar strip is pointer-
        // transparent apart from its card); a click on the card itself is a
        // dismissal too — nothing on the overlay is interactive.
        event.preventDefault()
        this.dismiss.emit()
    }

    private rebuild(): void {
        const prefix = this.prefixKey
        this.title = this.i18n.t('prefix.title', { prefix })
        this.hint = this.i18n.t('prefix.escHint')
        this.groups = PREFIX_OVERLAY_GROUPS.map((group) => ({
            label: this.i18n.t(group.label),
            rows: group.entries.map((entry) => ({
                keys: entry.keys ?? prefix,
                label: this.i18n.t(entry.label, { prefix }),
            })),
        }))
    }
}
