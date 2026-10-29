import { Injectable } from '@angular/core'
import { ConfigService, LocaleService } from 'tabby-core'
import { Observable, Subject } from 'rxjs'
import { resolveTmuxLocale, translateTmux, TmuxLocale, TmuxTranslationKey } from '../i18n'
import { TmuxConfigChangeService } from './tmuxConfigChange.service'

/**
 * Tabby 语言的权威源是 LocaleService（tabby-core 对外 export 给插件用）：
 * 它的 setLocale() 只调 translate.setDefaultLang()、从不调 translate.use()，
 * 所以 TranslateService.onLangChange 在 Tabby 里永远不会触发——必须订阅
 * LocaleService.localeChanged$，初始值用 LocaleService.getLocale()。
 *
 * The effective locale is derived from two inputs: Tabby's locale and the
 * `tmuxPlugin.forceEnglish` setting. Both are kept separately so unchecking
 * the setting falls back to Tabby's locale again. Settings changes arrive via
 * TmuxConfigChangeService because ConfigService has no change observable.
 */
@Injectable({ providedIn: 'root' })
export class TmuxI18nService {
    private tabbyLocale: TmuxLocale
    private locale: TmuxLocale
    private readonly languageChanges = new Subject<TmuxLocale>()
    readonly languageChange$: Observable<TmuxLocale> = this.languageChanges.asObservable()

    constructor(
        private localeService: LocaleService,
        private configService: ConfigService,
        configChanges: TmuxConfigChangeService,
    ) {
        this.tabbyLocale = resolveTmuxLocale(this.localeService.getLocale())
        this.locale = this.resolveEffectiveLocale()
        this.localeService.localeChanged$.subscribe((language) => {
            this.tabbyLocale = resolveTmuxLocale(language)
            this.applyEffectiveLocale()
        })
        configChanges.changed$.subscribe(() => this.applyEffectiveLocale())
    }

    t(key: TmuxTranslationKey, params: Record<string, string | number> = {}): string {
        return translateTmux(this.locale, key, params)
    }

    private get forceEnglish(): boolean {
        return this.configService.store?.tmuxPlugin?.forceEnglish === true
    }

    private resolveEffectiveLocale(): TmuxLocale {
        return this.forceEnglish ? 'en' : this.tabbyLocale
    }

    private applyEffectiveLocale(): void {
        const nextLocale = this.resolveEffectiveLocale()
        if (nextLocale === this.locale) {
            return
        }
        this.locale = nextLocale
        this.languageChanges.next(nextLocale)
    }
}
