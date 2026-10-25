import { describe, expect, it, vi } from 'vitest'
import type {
    ConfigService,
    LogService,
    MenuItemOptions,
    TabContextMenuItemProvider,
} from 'tabby-core'
import type {
    BaseTerminalProfile,
    BaseTerminalTabComponent,
    TerminalContextMenuItemProvider,
} from 'tabby-terminal'
import {
    HIDDEN_BUILTIN_MENU_PROVIDERS,
    getExcludedMenuProviders,
    TMUX_MENU_PROVIDER,
} from '../tmuxMenu'
import { TmuxMenuService } from './tmuxMenu.service'

vi.mock('tabby-core', () => ({
    ConfigService: class {},
    LogService: class {},
    TabContextMenuItemProvider: class {},
}))
vi.mock('tabby-terminal', () => ({ TerminalContextMenuItemProvider: class {} }))

function provider(name: string, items: MenuItemOptions[], weight = 0) {
    return {
        constructor: { name },
        weight,
        getItems: vi.fn(async () => items),
    } as unknown as TabContextMenuItemProvider & { getItems: ReturnType<typeof vi.fn> }
}

function setup(
    providers: TabContextMenuItemProvider[],
    legacy: TerminalContextMenuItemProvider[] = [],
) {
    const config = {
        store: { tmuxPlugin: { excludedMenuProviders: undefined as unknown } },
        enabledServices: vi.fn((sources: object[]) => sources),
    }
    const warn = vi.fn()
    const service = new TmuxMenuService(
        config as unknown as ConfigService,
        { create: () => ({ warn }) } as unknown as LogService,
        providers,
        legacy,
    )
    const pane = {
        session: { open: true },
        paneId: 3,
    } as unknown as BaseTerminalTabComponent<BaseTerminalProfile>
    return { config, service, pane, warn }
}

describe('tmux pane menu composition', () => {
    it('includes third-party menus for the clicked pane, preserves callbacks and provider order', async () => {
        const click = vi.fn()
        const thirdParty = provider(
            'PushContextMenuProvider',
            [{ label: 'Push Toolkit', submenu: [{ label: 'Upload', click }] }],
            10,
        )
        const tmux = Object.assign(provider('TmuxContextMenuProvider', [{ label: 'Tmux' }], 5), {
            [TMUX_MENU_PROVIDER]: true,
        })
        const early = provider('EarlyProvider', [{ label: 'Early' }], -5)
        const { service, pane } = setup([thirdParty, tmux, early])
        const menu = await service.buildMenu(pane)
        expect(menu.map((item) => item.label ?? item.type)).toEqual([
            'Early',
            'separator',
            'Tmux',
            'separator',
            'Push Toolkit',
        ])
        expect(thirdParty.getItems).toHaveBeenCalledWith(pane)
        menu[4].submenu?.[0].click?.()
        expect(click).toHaveBeenCalledOnce()
        expect(
            service.getGroups().find((group) => group.id === 'tab:PushContextMenuProvider')?.label,
        ).toBe('Push Toolkit')
        expect(
            service.getGroups().some((group) => group.id === 'tab:TmuxContextMenuProvider'),
        ).toBe(false)
    })

    it('hides built-in groups from both settings and pane menus, including with saved settings', async () => {
        const native = [
            'CopyPasteContextMenu',
            'CommonOptionsContextMenu',
            'TabManagementContextMenu',
            'MiscContextMenu',
            'ProfilesContextMenu',
            'SaveAsProfileContextMenu',
            'TaskCompletionContextMenu',
            'ReconnectContextMenu',
            'SFTPContextMenu',
            'NewTabContextMenu',
        ].map((name) => provider(name, [{ label: name }]))
        const plugin = provider('PushContextMenuProvider', [{ label: 'Push Toolkit' }])
        const { config, service, pane } = setup([...native, plugin])
        // Old configs may contain the previous default list; an explicit empty
        // list must not bring built-ins back either.
        for (const saved of [
            undefined,
            [],
            HIDDEN_BUILTIN_MENU_PROVIDERS.slice(0, 6),
            HIDDEN_BUILTIN_MENU_PROVIDERS,
        ]) {
            config.store.tmuxPlugin.excludedMenuProviders = saved
            expect(await service.buildMenu(pane)).toEqual([{ label: 'Push Toolkit' }])
            expect(service.getGroups().map((group) => group.id)).toEqual([
                'tab:PushContextMenuProvider',
            ])
        }
        for (const source of native) expect(source.getItems).not.toHaveBeenCalled()
    })

    it('hides built-ins saved in exclusions even when their providers are absent', () => {
        const { config, service } = setup([])
        config.store.tmuxPlugin.excludedMenuProviders = [
            ...HIDDEN_BUILTIN_MENU_PROVIDERS,
            'tab:UninstalledProvider',
        ]
        expect(service.getGroups().map((group) => group.id)).toEqual(['tab:UninstalledProvider'])
    })

    it('applies changed exclusions to the next menu, without invoking an excluded plugin', async () => {
        const plugin = provider('PushContextMenuProvider', [{ label: 'Push Toolkit' }])
        const { config, service, pane } = setup([plugin])
        config.store.tmuxPlugin.excludedMenuProviders = ['tab:PushContextMenuProvider']
        expect(await service.buildMenu(pane)).toEqual([])
        expect(plugin.getItems).not.toHaveBeenCalled()
        expect(
            service.getGroups().some((group) => group.id === 'tab:PushContextMenuProvider'),
        ).toBe(true)
        config.store.tmuxPlugin.excludedMenuProviders = []
        expect(await service.buildMenu(pane)).toEqual([{ label: 'Push Toolkit' }])
    })

    it('isolates synchronous and asynchronous failures and cleans empty sections and separators', async () => {
        const bad = provider('BadProvider', [])
        bad.getItems.mockImplementation(() => {
            throw new Error('incompatible')
        })
        const rejected = provider('RejectedProvider', [])
        rejected.getItems.mockRejectedValue(new Error('async failure'))
        const empty = provider('EmptyProvider', [{ type: 'separator' }])
        const good = provider('GoodProvider', [
            { type: 'separator' },
            { label: 'Good' },
            { type: 'separator' },
            { type: 'separator' },
        ])
        const { service, pane, warn } = setup([bad, empty, good, rejected])
        expect(await service.buildMenu(pane)).toEqual([{ label: 'Good' }])
        expect(warn).toHaveBeenCalledTimes(2)
        expect(warn.mock.calls[0][0]).toContain('tab:BadProvider')
    })

    it('exposes legacy plugins individually, without invoking the bridge or duplicating their menus', async () => {
        const bridge = provider('LegacyContextMenu', [{ label: 'Duplicate' }])
        const legacy = provider('LegacyUploadProvider', [{ label: 'Upload' }])
        const blocked = provider('LegacyBrokenProvider', [{ label: 'Broken' }])
        const { config, service, pane } = setup([bridge], [legacy, blocked])
        config.store.tmuxPlugin.excludedMenuProviders = ['terminal:LegacyBrokenProvider']
        expect(await service.buildMenu(pane)).toEqual([{ label: 'Upload' }])
        expect(legacy.getItems).toHaveBeenCalledExactlyOnceWith(pane)
        expect(bridge.getItems).not.toHaveBeenCalled()
        expect(blocked.getItems).not.toHaveBeenCalled()
        expect(service.getGroups().map((group) => group.id)).toEqual([
            'terminal:LegacyUploadProvider',
            'terminal:LegacyBrokenProvider',
        ])
    })

    it('respects globally disabled plugins and retains stale exclusions for editing', async () => {
        const disabled = provider('DisabledProvider', [{ label: 'Disabled' }])
        const { config, service, pane } = setup([disabled])
        config.enabledServices.mockReturnValue([])
        config.store.tmuxPlugin.excludedMenuProviders = ['tab:UninstalledProvider']
        expect(await service.buildMenu(pane)).toEqual([])
        expect(disabled.getItems).not.toHaveBeenCalled()
        expect(service.getGroups().map((group) => group.id)).toEqual(['tab:UninstalledProvider'])
    })

    it('does not bypass a globally disabled legacy bridge', async () => {
        const bridge = provider('LegacyContextMenu', [])
        const legacy = provider('LegacyProvider', [{ label: 'Upload' }])
        const { config, service, pane } = setup([bridge], [legacy])
        config.enabledServices.mockReturnValue([])
        expect(await service.buildMenu(pane)).toEqual([])
        expect(legacy.getItems).not.toHaveBeenCalled()
    })

    it('keeps tmux actions available even if its provider ID appears in exclusions', async () => {
        const tmux = Object.assign(provider('TmuxContextMenuProvider', [{ label: 'Close pane' }]), {
            [TMUX_MENU_PROVIDER]: true,
        })
        const { config, service, pane } = setup([tmux])
        config.store.tmuxPlugin.excludedMenuProviders = ['tab:TmuxContextMenuProvider']
        expect(await service.buildMenu(pane)).toEqual([{ label: 'Close pane' }])
        expect(service.getGroups()).toEqual([])
    })

    it('accepts empty exclusions, deduplicates IDs, and falls back only for invalid settings', () => {
        expect(getExcludedMenuProviders([])).toEqual([])
        expect(getExcludedMenuProviders(['a', 'a'])).toEqual(['a'])
        for (const invalid of [undefined, null, 'bad', [false]]) {
            expect(getExcludedMenuProviders(invalid)).toEqual([])
        }
    })
})
