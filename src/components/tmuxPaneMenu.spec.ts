import { createRequire } from 'module'
import { join } from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConfigService, LogService, TabContextMenuItemProvider } from 'tabby-core'
import type { TmuxI18nService } from '../services/tmuxI18n.service'
import type { TmuxService } from '../services/tmux.service'
import { TmuxMenuService } from '../services/tmuxMenu.service'

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
