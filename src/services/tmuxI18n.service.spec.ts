import { Subject } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigService, LocaleService } from 'tabby-core'
import { TmuxConfigChangeService } from './tmuxConfigChange.service'
import { TmuxI18nService } from './tmuxI18n.service'

vi.mock('tabby-core', () => ({
    LocaleService: class {},
    ConfigService: class {},
}))

function createLocaleService(currentLocale: string) {
    return {
        currentLocale,
        localeChanged: new Subject<string>(),
        getLocale() {
            return this.currentLocale
        },
        get localeChanged$() {
            return this.localeChanged.asObservable()
        },
    }
}

function createI18nService(currentLocale: string, forceEnglish = false) {
    const localeService = createLocaleService(currentLocale)
    const config = { store: { tmuxPlugin: { forceEnglish } } }
    const configChanges = new TmuxConfigChangeService()
    return {
        localeService,
        config,
        configChanges,
        service: new TmuxI18nService(
            localeService as unknown as LocaleService,
            config as unknown as ConfigService,
            configChanges,
        ),
    }
}

describe('TmuxI18nService', () => {
    it('resolves the initial locale from LocaleService', () => {
        const { service } = createI18nService('zh-CN')

        expect(service.t('mode.enter')).toBe('进入 Tmux 模式')
    })

    it('falls back to English for unrecognized locales', () => {
        const { service } = createI18nService('fr-FR')

        expect(service.t('mode.enter')).toBe('Enter Tmux Mode')
    })

    it('updates translations when Tabby changes language', () => {
        const { service, localeService } = createI18nService('en-US')
        const changes: string[] = []
        service.languageChange$.subscribe((locale) => changes.push(locale))

        localeService.localeChanged.next('zh-CN')

        expect(service.t('mode.disconnect')).toBe('断开连接')
        expect(changes).toEqual(['zh'])
    })

    it('does not emit when the resolved locale is unchanged', () => {
        const { service, localeService } = createI18nService('en-US')
        const changes: string[] = []
        service.languageChange$.subscribe((locale) => changes.push(locale))

        localeService.localeChanged.next('en-GB')

        expect(changes).toEqual([])
    })

    describe('forceEnglish', () => {
        it('uses English from startup when the setting is on', () => {
            const { service } = createI18nService('zh-TW', true)

            expect(service.t('mode.enter')).toBe('Enter Tmux Mode')
        })

        it('keeps English when Tabby switches language while forced', () => {
            const { service, localeService } = createI18nService('en-US', true)
            const changes: string[] = []
            service.languageChange$.subscribe((locale) => changes.push(locale))

            localeService.localeChanged.next('zh-CN')

            expect(service.t('mode.enter')).toBe('Enter Tmux Mode')
            expect(changes).toEqual([])
        })

        it('switches to English immediately when the setting is turned on', () => {
            const { service, config, configChanges } = createI18nService('zh-TW')
            const changes: string[] = []
            service.languageChange$.subscribe((locale) => changes.push(locale))
            expect(service.t('mode.enter')).toBe('进入 Tmux 模式')

            config.store.tmuxPlugin.forceEnglish = true
            configChanges.notifyChanged()

            expect(service.t('mode.enter')).toBe('Enter Tmux Mode')
            expect(changes).toEqual(['en'])
        })

        it('falls back to the Tabby locale when the setting is turned off again', () => {
            const { service, config, configChanges, localeService } = createI18nService(
                'zh-TW',
                true,
            )
            const changes: string[] = []
            service.languageChange$.subscribe((locale) => changes.push(locale))

            // Tabby locale changes are tracked even while forced to English.
            localeService.localeChanged.next('zh-CN')
            config.store.tmuxPlugin.forceEnglish = false
            configChanges.notifyChanged()

            expect(service.t('mode.enter')).toBe('进入 Tmux 模式')
            expect(changes).toEqual(['zh'])
        })

        it('does not emit when an unrelated setting changes', () => {
            const { service, configChanges } = createI18nService('en-US')
            const changes: string[] = []
            service.languageChange$.subscribe((locale) => changes.push(locale))

            configChanges.notifyChanged()

            expect(changes).toEqual([])
        })
    })
})
