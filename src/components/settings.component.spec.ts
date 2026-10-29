import { createRequire } from 'module'
import { join } from 'path'
import { Subject } from 'rxjs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ChangeDetectorRef } from '@angular/core'
import type { NgModel } from '@angular/forms'
import type { ConfigService } from 'tabby-core'
import type { TmuxI18nService } from '../services/tmuxI18n.service'
import { TmuxConfigChangeService } from '../services/tmuxConfigChange.service'
import type { TmuxMenuService } from '../services/tmuxMenu.service'

vi.mock('../services/tmuxMenu.service', () => ({ TmuxMenuService: class {} }))

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
            { getGroups: () => [] } as unknown as TmuxMenuService,
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

describe('tmux prefix key settings', () => {
    type PrefixKeyEvent = {
        key: string
        code: string
        ctrlKey: boolean
        altKey: boolean
        shiftKey: boolean
        metaKey: boolean
        preventDefault: ReturnType<typeof vi.fn>
        stopPropagation: ReturnType<typeof vi.fn>
    }

    function keyEvent(key: string, modifiers: Partial<PrefixKeyEvent> = {}): PrefixKeyEvent {
        return {
            key,
            code: `Key${key.toUpperCase()}`,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            ...modifiers,
        }
    }

    function createComponent(tmuxPlugin: Record<string, unknown> = {}, hotkeys: unknown = {}) {
        const save = vi.fn()
        const config = {
            store: { tmuxPlugin: { ...tmuxPlugin }, hotkeys },
            save,
        } as unknown as ConfigService
        const changes = new TmuxConfigChangeService()
        const notified = vi.fn()
        const subscription = changes.changed$.subscribe(notified)
        const component = new Settings(
            config,
            {
                languageChange$: new Subject<string>(),
                t: (key: string) => key,
            } as unknown as TmuxI18nService,
            { detectChanges: vi.fn() } as unknown as ChangeDetectorRef,
            changes,
            { getGroups: () => [] } as unknown as TmuxMenuService,
        )
        return { component, config, save, notified, subscription }
    }

    it('falls back to Ctrl-B and the bar overlay for missing or invalid config', () => {
        const { component, subscription } = createComponent({ prefixKey: 'B' })
        try {
            expect(component.prefixKey).toBe('Ctrl-B')
            expect(component.prefixOverlayStyle).toBe('bar')
        } finally {
            component.ngOnDestroy()
            subscription.unsubscribe()
        }
    })

    it('records a valid combination, saves it and notifies the plugin', () => {
        const { component, config, save, notified, subscription } = createComponent()
        try {
            component.startPrefixRecording()
            expect(component.prefixRecording).toBe(true)

            // A bare modifier keeps the recorder armed.
            const ctrl = keyEvent('Control', { code: 'ControlLeft', ctrlKey: true })
            component.onPrefixKeydown(ctrl as unknown as KeyboardEvent)
            expect(ctrl.preventDefault).toHaveBeenCalled()
            expect(component.prefixRecording).toBe(true)

            const stroke = keyEvent('a', { ctrlKey: true })
            component.onPrefixKeydown(stroke as unknown as KeyboardEvent)
            expect(stroke.preventDefault).toHaveBeenCalled()
            expect(stroke.stopPropagation).toHaveBeenCalled()
            expect(config.store.tmuxPlugin.prefixKey).toBe('Ctrl-A')
            expect(component.prefixKey).toBe('Ctrl-A')
            expect(component.prefixRecording).toBe(false)
            expect(component.prefixError).toBe(false)
            expect(save).toHaveBeenCalledTimes(1)
            expect(notified).toHaveBeenCalledTimes(1)
        } finally {
            component.ngOnDestroy()
            subscription.unsubscribe()
        }
    })

    it('rejects strokes without Ctrl/Alt and keeps recording until Esc', () => {
        const { component, config, save, subscription } = createComponent()
        try {
            component.startPrefixRecording()
            component.onPrefixKeydown(keyEvent('b') as unknown as KeyboardEvent)
            expect(component.prefixError).toBe(true)
            expect(component.prefixRecording).toBe(true)
            component.onPrefixKeydown(keyEvent('b', { shiftKey: true }) as unknown as KeyboardEvent)
            expect(component.prefixError).toBe(true)
            expect(config.store.tmuxPlugin.prefixKey).toBeUndefined()

            component.onPrefixKeydown(
                keyEvent('Escape', { code: 'Escape' }) as unknown as KeyboardEvent,
            )
            expect(component.prefixRecording).toBe(false)
            expect(save).not.toHaveBeenCalled()

            // Not recording: keydowns are left alone.
            const stray = keyEvent('a', { ctrlKey: true })
            component.onPrefixKeydown(stray as unknown as KeyboardEvent)
            expect(stray.preventDefault).not.toHaveBeenCalled()
            expect(config.store.tmuxPlugin.prefixKey).toBeUndefined()
        } finally {
            component.ngOnDestroy()
            subscription.unsubscribe()
        }
    })

    it('warns about Tabby hotkeys the prefix would shadow and resets to the default', () => {
        const { component, config, save, subscription } = createComponent(
            { prefixKey: 'Ctrl-Shift-X' },
            { 'close-tab': ['Ctrl-Shift-W'], tmuxPlugin: { 'toggle-tmux-mode': ['Ctrl-Shift-X'] } },
        )
        try {
            expect(component.prefixConflicts).toEqual(['tmuxPlugin.toggle-tmux-mode'])
            component.resetPrefixKey()
            expect(config.store.tmuxPlugin.prefixKey).toBe('Ctrl-B')
            expect(component.prefixConflicts).toEqual([])
            expect(save).toHaveBeenCalledTimes(1)
        } finally {
            component.ngOnDestroy()
            subscription.unsubscribe()
        }
    })

    it('persists the overlay style and normalizes unknown values', () => {
        const { component, config, save, subscription } = createComponent()
        try {
            component.setPrefixOverlayStyle('modal')
            expect(config.store.tmuxPlugin.prefixOverlayStyle).toBe('modal')
            expect(component.prefixOverlayStyle).toBe('modal')
            component.setPrefixOverlayStyle('nonsense')
            expect(config.store.tmuxPlugin.prefixOverlayStyle).toBe('bar')
            expect(save).toHaveBeenCalledTimes(2)
            expect(component.prefixOverlayStyleLabel('modal')).toBe('settings.prefixOverlayModal')
            expect(component.prefixOverlayStyleLabel('bar')).toBe('settings.prefixOverlayBar')
        } finally {
            component.ngOnDestroy()
            subscription.unsubscribe()
        }
    })
})

describe('pane menu exclusion settings', () => {
    it('saves third-party exclusions and resets them', () => {
        const save = vi.fn()
        const config = {
            store: { tmuxPlugin: { excludedMenuProviders: undefined as string[] | undefined } },
            save,
        } as unknown as ConfigService
        const changes = new TmuxConfigChangeService()
        const notified = vi.fn()
        const subscription = changes.changed$.subscribe(notified)
        const groups = [{ id: 'tab:push-toolkit:0', label: 'Push Toolkit' }]
        const component = new Settings(
            config,
            { languageChange$: new Subject<string>() } as unknown as TmuxI18nService,
            { detectChanges: vi.fn() } as unknown as ChangeDetectorRef,
            changes,
            { getGroups: () => groups } as unknown as TmuxMenuService,
        )
        try {
            expect(component.menuGroups).toEqual(groups)
            component.setMenuExcluded(groups[0].id, true)
            expect(component.isMenuExcluded(groups[0].id)).toBe(true)
            component.setMenuExcluded(groups[0].id, true)
            expect(config.store.tmuxPlugin.excludedMenuProviders).toEqual([groups[0].id])
            component.setMenuExcluded(groups[0].id, false)
            expect(config.store.tmuxPlugin.excludedMenuProviders).toEqual([])
            expect(component.isMenuExcluded(groups[0].id)).toBe(false)
            component.setMenuExcluded(groups[0].id, true)
            component.resetMenuExclusions()
            expect(config.store.tmuxPlugin.excludedMenuProviders).toEqual([])
            expect(save.mock.calls.length).toBe(5)
            expect(notified.mock.calls.length).toBe(5)
        } finally {
            component.ngOnDestroy()
            subscription.unsubscribe()
        }
    })
})
