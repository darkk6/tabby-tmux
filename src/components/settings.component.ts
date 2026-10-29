import { ChangeDetectorRef, Component, OnDestroy } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { Subscription } from 'rxjs'
import type { NgModel } from '@angular/forms'
import { TmuxI18nService } from '../services/tmuxI18n.service'
import { TmuxConfigChangeService } from '../services/tmuxConfigChange.service'
import { copyTextToClipboard } from '../clipboard'
import { MAX_HISTORY_RESTORE_LIMIT, normalizeHistoryRestoreLimit } from '../historyRestore'
import { TmuxMenuService, TmuxMenuGroup } from '../services/tmuxMenu.service'
import { getExcludedMenuProviders } from '../tmuxMenu'

// eslint-disable-next-line new-cap
@Component({
    template: `
        <h3>{{ i18n.t('settings.title') }}</h3>
        <div class="tmux-settings-tab">
            <div class="tmux-table">
                <div class="setting-row">
                    <div class="header">
                        <div class="title">{{ i18n.t('settings.forceEnglish') }}</div>
                    </div>
                    <input
                        type="checkbox"
                        [(ngModel)]="config.store.tmuxPlugin.forceEnglish"
                        (ngModelChange)="saveConfig()"
                    />
                </div>
                <div class="setting-row">
                    <div class="header">
                        <div class="title">{{ i18n.t('settings.defaultSessionName') }}</div>
                    </div>
                    <input
                        class="form-control"
                        type="text"
                        [(ngModel)]="config.store.tmuxPlugin.defaultSessionName"
                        (ngModelChange)="saveConfig()"
                    />
                </div>
                <div class="setting-row">
                    <div class="header">
                        <div class="title">{{ i18n.t('settings.sessionTitleFormat') }}</div>
                    </div>
                    <input
                        class="form-control"
                        type="text"
                        [(ngModel)]="config.store.tmuxPlugin.sessionTitleFormat"
                        (ngModelChange)="saveConfig()"
                    />
                </div>
                <div class="setting-row">
                    <div class="header">
                        <div class="title">{{ i18n.t('settings.historyRestoreLimit') }}</div>
                    </div>
                    <div class="setting-value">
                        <input
                            class="form-control"
                            type="number"
                            #historyLimitModel="ngModel"
                            min="0"
                            [max]="maxHistoryRestoreLimit"
                            step="1"
                            [ngModel]="config.store.tmuxPlugin.historyRestoreLimit"
                            [ngModelOptions]="{ updateOn: 'blur' }"
                            (ngModelChange)="setHistoryRestoreLimit($event, historyLimitModel)"
                        />
                        <small class="text-muted">{{
                            i18n.t('settings.historyRestoreLimitHelp')
                        }}</small>
                    </div>
                </div>
                <div class="setting-row">
                    <div class="header">
                        <div class="title">{{ i18n.t('settings.commandTimeout') }}</div>
                    </div>
                    <input
                        class="form-control"
                        type="number"
                        [(ngModel)]="config.store.tmuxPlugin.commandTimeoutMs"
                        (ngModelChange)="saveConfig()"
                    />
                </div>
                <div class="setting-row">
                    <div class="header">
                        <div class="title">{{ i18n.t('settings.sendKeysChunkSize') }}</div>
                    </div>
                    <input
                        class="form-control"
                        type="number"
                        [(ngModel)]="config.store.tmuxPlugin.sendKeysChunkSize"
                        (ngModelChange)="saveConfig()"
                    />
                </div>
                <div class="setting-row">
                    <div class="header">
                        <div class="title">{{ i18n.t('settings.resizeDebounce') }}</div>
                    </div>
                    <input
                        class="form-control"
                        type="number"
                        [(ngModel)]="config.store.tmuxPlugin.resizeDebounceMs"
                        (ngModelChange)="saveConfig()"
                    />
                </div>
                <div class="setting-row">
                    <div class="header">
                        <div class="title">{{ i18n.t('settings.debugLogging') }}</div>
                    </div>
                    <input
                        type="checkbox"
                        [(ngModel)]="config.store.tmuxPlugin.debugLogging"
                        (ngModelChange)="saveConfig()"
                    />
                </div>
                <div class="setting-row">
                    <div class="header">
                        <div class="title">{{ i18n.t('settings.showCloseButton') }}</div>
                    </div>
                    <input
                        type="checkbox"
                        [(ngModel)]="config.store.tmuxPlugin.showWindowCloseButton"
                        (ngModelChange)="saveConfig()"
                    />
                </div>
            </div>
            <div class="menu-exclusions">
                <h4>{{ i18n.t('settings.excludedMenus') }}</h4>
                <p class="text-muted">{{ i18n.t('settings.excludedMenusHelp') }}</p>
                <label
                    class="menu-exclusion"
                    *ngFor="let group of menuGroups; trackBy: trackMenuGroup"
                >
                    <input
                        type="checkbox"
                        [checked]="isMenuExcluded(group.id)"
                        (change)="setMenuExcluded(group.id, $any($event.target).checked)"
                    />
                    <span>
                        {{ group.label }}
                        <small class="text-muted">{{ group.id }}</small>
                    </span>
                </label>
                <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    (click)="resetMenuExclusions()"
                >
                    {{ i18n.t('settings.resetMenuExclusions') }}
                </button>
            </div>
            <div class="format-help" role="note">
                <div class="format-help-header">
                    <div class="format-help-title">
                        <span class="format-help-icon" aria-hidden="true">?</span>
                        <span>{{ i18n.t('settings.sessionTitleFormatHelp') }}</span>
                    </div>
                    <button
                        type="button"
                        class="format-help-copy"
                        (click)="copySessionTitleFormatVariables()"
                    >
                        {{
                            helpCopied
                                ? i18n.t('settings.sessionTitleFormatCopied')
                                : i18n.t('settings.copySessionTitleFormat')
                        }}
                    </button>
                </div>
                <code class="format-help-variables">
                    {{ i18n.t('settings.sessionTitleFormatVariables') }}
                </code>
            </div>
        </div>
    `,
    styles: [require('./settings.component.scss')],
})
export class TmuxSettingsTabComponent implements OnDestroy {
    private languageSubscription: Subscription
    private copyResetTimer: ReturnType<typeof setTimeout> | null = null
    helpCopied = false
    readonly maxHistoryRestoreLimit = MAX_HISTORY_RESTORE_LIMIT

    constructor(
        public config: ConfigService,
        public i18n: TmuxI18nService,
        private cdr: ChangeDetectorRef,
        private configChanges: TmuxConfigChangeService,
        private menus: TmuxMenuService,
    ) {
        this.languageSubscription = this.i18n.languageChange$.subscribe(() =>
            this.cdr.detectChanges(),
        )
    }

    saveConfig(): void {
        this.config.save()
        this.configChanges.notifyChanged()
    }

    get menuGroups(): TmuxMenuGroup[] {
        return this.menus.getGroups()
    }

    trackMenuGroup(_index: number, group: TmuxMenuGroup): string {
        return group.id
    }

    isMenuExcluded(id: string): boolean {
        return getExcludedMenuProviders(
            this.config.store.tmuxPlugin.excludedMenuProviders,
        ).includes(id)
    }

    setMenuExcluded(id: string, excluded: boolean): void {
        const ids = new Set(
            getExcludedMenuProviders(this.config.store.tmuxPlugin.excludedMenuProviders),
        )
        if (excluded) ids.add(id)
        else ids.delete(id)
        this.config.store.tmuxPlugin.excludedMenuProviders = [...ids]
        this.saveConfig()
    }

    resetMenuExclusions(): void {
        this.config.store.tmuxPlugin.excludedMenuProviders = []
        this.saveConfig()
    }

    setHistoryRestoreLimit(value: unknown, model?: NgModel): void {
        const limit = normalizeHistoryRestoreLimit(value)
        this.config.store.tmuxPlugin.historyRestoreLimit = limit
        if (value !== limit) {
            model?.control.setValue(limit, { emitViewToModelChange: false })
        }
        this.saveConfig()
    }

    async copySessionTitleFormatVariables(): Promise<void> {
        const text = this.i18n.t('settings.sessionTitleFormatVariables')

        try {
            await copyTextToClipboard(text)
            this.helpCopied = true
            this.cdr.detectChanges()

            if (this.copyResetTimer) {
                clearTimeout(this.copyResetTimer)
            }
            this.copyResetTimer = setTimeout(() => {
                this.helpCopied = false
                this.copyResetTimer = null
                this.cdr.detectChanges()
            }, 2000)
        } catch {
            this.helpCopied = false
        }
    }

    ngOnDestroy(): void {
        if (this.copyResetTimer) {
            clearTimeout(this.copyResetTimer)
            this.copyResetTimer = null
        }
        this.languageSubscription.unsubscribe()
    }
}
