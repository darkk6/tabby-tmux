import { createRequire } from 'module'
import { join } from 'path'
import { Subject } from 'rxjs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ChangeDetectorRef } from '@angular/core'
import type { NgModel } from '@angular/forms'
import type { ConfigService } from 'tabby-core'
import type { TmuxI18nService } from '../services/tmuxI18n.service'
import { TmuxConfigChangeService } from '../services/tmuxConfigChange.service'

vi.mock('tabby-core', () => ({ ConfigService: class {}, LocaleService: class {} }))

let Settings: typeof import('./settings.component').TmuxSettingsTabComponent

beforeAll(async () => {
    // Webpack normally loads this stylesheet. Keep the Node test focused on
    // settings behavior, without replacing Angular or the component itself.
    const require = createRequire(join(process.cwd(), 'package.json'))
    const previous = require.extensions['.scss']
    require.extensions['.scss'] = (module) => {
        module.exports = ''
    }
    try {
        Settings = (await import('./settings.component')).TmuxSettingsTabComponent
    } finally {
        if (previous) require.extensions['.scss'] = previous
        else delete require.extensions['.scss']
    }
})

describe('history restoration settings', () => {
    it.each([
        { value: 1200, expected: 1200 },
        { value: 0, expected: 0 },
        { value: null, expected: 5000 },
        { value: -1, expected: 5000 },
        { value: Number.MAX_SAFE_INTEGER, expected: 5000 },
    ])('persists $value as $expected and notifies the plugin', ({ value, expected }) => {
        const save = vi.fn()
        const config = {
            store: { tmuxPlugin: { historyRestoreLimit: 5000 } },
            save,
        } as unknown as ConfigService
        const changes = new TmuxConfigChangeService()
        const notified = vi.fn()
        const subscription = changes.changed$.subscribe(notified)
        const component = new Settings(
            config,
            { languageChange$: new Subject<string>() } as unknown as TmuxI18nService,
            { detectChanges: vi.fn() } as unknown as ChangeDetectorRef,
            changes,
        )
        const setValue = vi.fn()
        const model = { control: { setValue } } as unknown as NgModel
        try {
            component.setHistoryRestoreLimit(value, model)
            expect(config.store.tmuxPlugin.historyRestoreLimit).toBe(expected)
            expect(save).toHaveBeenCalledOnce()
            expect(notified).toHaveBeenCalledOnce()
            if (value !== expected) {
                // Keep the displayed number and validity in sync with the saved
                // fallback, without emitting another ngModelChange/save cycle.
                expect(setValue).toHaveBeenCalledWith(expected, { emitViewToModelChange: false })
            } else {
                expect(setValue).not.toHaveBeenCalled()
            }
        } finally {
            component.ngOnDestroy()
            subscription.unsubscribe()
        }
    })
})
