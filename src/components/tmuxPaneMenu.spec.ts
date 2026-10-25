import { createRequire } from 'module'
import { join } from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConfigService, LogService, TabContextMenuItemProvider } from 'tabby-core'
import type { TmuxI18nService } from '../services/tmuxI18n.service'
import type { TmuxService } from '../services/tmux.service'
import { TmuxMenuService } from '../services/tmuxMenu.service'
import { translateTmux, TmuxLocale, TmuxTranslationKey } from '../i18n'
import type { SyncScope } from '../session'

vi.mock('tabby-core', () => ({
    ConfigService: class {},
    LogService: class {},
    TabContextMenuItemProvider: class {},
}))
vi.mock('tabby-terminal', () => ({
    BaseTerminalTabComponent: class {
        static template = ''
        static styles = []
        static animations = []
    },
    TerminalContextMenuItemProvider: class {},
}))
vi.mock('../session', () => ({ TmuxController: class {}, TmuxPaneSession: class {} }))
vi.mock('../services/tmux.service', () => ({ TmuxService: class {} }))
vi.mock('../services/tmuxI18n.service', () => ({ TmuxI18nService: class {} }))
vi.mock('./tmuxSessionTab.component', () => ({ TmuxSessionTabComponent: class {} }))

let Pane: typeof import('./tmuxPaneTab.component').TmuxPaneTabComponent
let Provider: typeof import('../tabContextMenu').TmuxContextMenuProvider

beforeAll(async () => {
    const require = createRequire(join(process.cwd(), 'package.json'))
    const previous = require.extensions['.scss']
    require.extensions['.scss'] = (module) => {
        module.exports = ''
    }
    try {
        Pane = (await import('./tmuxPaneTab.component')).TmuxPaneTabComponent
        Provider = (await import('../tabContextMenu')).TmuxContextMenuProvider
    } finally {
        if (previous) require.extensions['.scss'] = previous
        else delete require.extensions['.scss']
    }
})

describe('tmux pane menu integration', () => {
    it.each([
        ['en', 'off', 'Focus all tmux panes'],
        ['en', 'window', 'Focus all tmux panes ✓'],
        ['en', 'all', 'Focus all tmux panes ✓'],
        ['zh', 'off', '聚焦所有 tmux pane'],
        ['zh', 'window', '聚焦所有 tmux pane ✓'],
        ['zh', 'all', '聚焦所有 tmux pane ✓'],
    ] as [TmuxLocale, SyncScope, string][])(
        'marks the parent menu when %s %s sync is enabled',
        (locale, scope, label) => {
            const pane = Object.assign(Object.create(Pane.prototype), {
                i18n: {
                    t: (key: TmuxTranslationKey, params?: Record<string, string | number>) =>
                        translateTmux(locale, key, params),
                },
                controller: {
                    getSyncScope: () => scope,
                    isPaneZoomed: () => false,
                    getWindowPaneCount: () => 2,
                },
            }) as InstanceType<typeof Pane>

            const item = pane.buildTmuxContextMenu().find((entry) => entry.label === label)
            expect(item).toBeDefined()
            expect(item?.submenu?.map((entry) => entry.checked)).toEqual([
                scope === 'window',
                scope === 'all',
            ])
        },
    )

    it('refreshes the parent label when switching scopes and turning sync off', () => {
        let scope: SyncScope = 'off'
        const pane = Object.assign(Object.create(Pane.prototype), {
            i18n: {
                t: (key: TmuxTranslationKey, params?: Record<string, string | number>) =>
                    translateTmux('en', key, params),
            },
            controller: {
                getSyncScope: () => scope,
                setSyncScope: (value: SyncScope) => {
                    scope = value
                },
                isPaneZoomed: () => false,
                getWindowPaneCount: () => 2,
            },
        }) as InstanceType<typeof Pane>
        const syncMenu = () => {
            const item = pane
                .buildTmuxContextMenu()
                .find((entry) => entry.label?.includes('Focus all tmux panes'))
            if (!item) throw new Error('Missing synchronized-input menu')
            return item
        }

        syncMenu().submenu?.[0].click?.()
        expect(syncMenu().label).toBe('Focus all tmux panes ✓')
        expect(syncMenu().submenu?.map((item) => item.checked)).toEqual([true, false])
        syncMenu().submenu?.[1].click?.()
        expect(syncMenu().label).toBe('Focus all tmux panes ✓')
        expect(syncMenu().submenu?.map((item) => item.checked)).toEqual([false, true])
        syncMenu().submenu?.[1].click?.()
        expect(syncMenu().label).toBe('Focus all tmux panes')
        expect(syncMenu().submenu?.map((item) => item.checked)).toEqual([false, false])
    })

    it('composes the real pane provider with plugins and routes Close to kill-pane', async () => {
        const i18n = { t: (key: string) => key } as unknown as TmuxI18nService
        const tmuxProvider = new Provider({} as TmuxService, i18n)
        const getItems = vi.fn(async () => [{ label: 'Push Toolkit' }])
        const plugin = { constructor: { name: 'PushContextMenuProvider' }, weight: 5, getItems }
        const menus = new TmuxMenuService(
            {
                store: { tmuxPlugin: {} },
                enabledServices: (sources: unknown[]) => sources,
                save: vi.fn().mockResolvedValue(undefined),
            } as unknown as ConfigService,
            { create: () => ({ warn: vi.fn() }) } as unknown as LogService,
            [tmuxProvider, plugin as unknown as TabContextMenuItemProvider],
            null,
        )
        const killPane = vi.fn()
        const disconnect = vi.fn()
        const pane = Object.assign(Object.create(Pane.prototype), {
            i18n,
            paneId: 7,
            session: { open: true },
            controller: {
                getSyncScope: () => 'off',
                isPaneZoomed: () => false,
                getWindowPaneCount: () => 2,
                killPane,
            },
            parent: { onDisconnect: disconnect },
            injector: {
                get: (token: unknown) => {
                    expect(token).toBe(TmuxMenuService)
                    return menus
                },
            },
        }) as InstanceType<typeof Pane>
        const menu = await pane.buildContextMenu()
        expect(menu.filter((item) => item.label === 'Push Toolkit')).toHaveLength(1)
        expect(menu.filter((item) => item.label === 'pane.close')).toHaveLength(1)
        expect(getItems).toHaveBeenCalledExactlyOnceWith(pane)
        menu.find((item) => item.label === 'pane.close')?.click?.()
        expect(killPane).toHaveBeenCalledWith(7)
        menu.find((item) => item.label === 'mode.exit')?.click?.()
        expect(disconnect).toHaveBeenCalledOnce()
        // Preserve the header menu's existing subset of tmux actions.
        expect((await tmuxProvider.getItems(pane, true)).map((item) => item.label)).toEqual([
            'mode.exit',
            'pane.rename',
            'pane.split',
            'pane.close',
        ])
    })
})
