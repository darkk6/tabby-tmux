import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabContextMenuItemProvider as TabMenuToken } from 'tabby-core'
import { TerminalContextMenuItemProvider as TerminalMenuToken } from 'tabby-terminal'
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
import { getExcludedMenuProviders, TMUX_MENU_PROVIDER } from '../tmuxMenu'
import { TmuxMenuService } from './tmuxMenu.service'

vi.mock('tabby-core', () => ({
    ConfigService: class {},
    LogService: class {},
    TabContextMenuItemProvider: class {},
}))
vi.mock('tabby-terminal', () => ({ TerminalContextMenuItemProvider: class {} }))

afterEach(() => vi.unstubAllGlobals())

function registerPlugins(
    ...plugins: Array<{
        name: string
        tab?: TabContextMenuItemProvider[]
        terminal?: TerminalContextMenuItemProvider[]
    }>
) {
    vi.stubGlobal('window', {
        pluginModules: plugins.map((plugin) => ({
            pluginName: plugin.name,
            ɵinj: {
                providers: [
                    ...(plugin.tab ?? []).map((source) => ({
                        provide: TabMenuToken,
                        useClass: source.constructor,
                    })),
                    ...(plugin.terminal ?? []).map((source) => ({
                        provide: TerminalMenuToken,
                        useClass: source.constructor,
                    })),
                ],
            },
        })),
    })
}

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
        store: {
            tmuxPlugin: {
                excludedMenuProviders: undefined as unknown,
                menuProviderLabels: undefined as unknown,
            },
        },
        enabledServices: vi.fn((sources: object[]) => sources),
        save: vi.fn().mockResolvedValue(undefined),
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
    it('discovers actual menu titles and retains them for excluded sources after restart', async () => {
        const bridge = provider('LegacyContextMenu', [])
        const exportMenu = provider('x', [{ label: 'Export to file' }])
        const customMenu = provider('y', [{ label: 'Custom actions' }])
        registerPlugins(
            { name: 'terminal', tab: [bridge] },
            { name: 'electron', terminal: [exportMenu] },
            { name: 'another-plugin', tab: [customMenu] },
        )
        const { config, service, pane } = setup([bridge, customMenu], [exportMenu])
        expect(service.getGroups()).toEqual([
            { id: 'terminal:electron:0', label: 'Electron' },
            { id: 'tab:another-plugin:0', label: 'Another Plugin' },
        ])
        expect(exportMenu.getItems).not.toHaveBeenCalled()
        await service.buildMenu(pane)
        expect(config.store.tmuxPlugin.menuProviderLabels).toEqual([
            { id: 'terminal:electron:0', label: 'Export to file' },
            { id: 'tab:another-plugin:0', label: 'Custom actions' },
        ])
        expect(config.save).toHaveBeenCalledOnce()
        config.store.tmuxPlugin.excludedMenuProviders = [
            'terminal:electron:0',
            'tab:another-plugin:0',
        ]
        const restartedConfig = {
            ...config,
            store: JSON.parse(JSON.stringify(config.store)),
        }
        const restarted = new TmuxMenuService(
            restartedConfig as unknown as ConfigService,
            { create: () => ({ warn: vi.fn() }) } as unknown as LogService,
            [bridge, customMenu],
            [exportMenu],
        )
        exportMenu.getItems.mockClear()
        customMenu.getItems.mockClear()
        expect(restarted.getGroups()).toEqual([
            { id: 'terminal:electron:0', label: 'Export to file' },
            { id: 'tab:another-plugin:0', label: 'Custom actions' },
        ])
        expect(await restarted.buildMenu(pane)).toEqual([])
        expect(exportMenu.getItems).not.toHaveBeenCalled()
        expect(customMenu.getItems).not.toHaveBeenCalled()
        expect(config.save).toHaveBeenCalledOnce()
    })

    it('updates learned titles from provider results and only saves when titles change', async () => {
        const plugin = provider('l', [])
        let title = 'Export to file'
        plugin.getItems.mockImplementation(async () => [{ label: title }])
        registerPlugins({ name: 'some-plugin', tab: [plugin] })
        const { config, service, pane } = setup([plugin])
        await service.buildMenu(pane)
        expect(service.getGroups()[0].label).toBe('Export to file')
        expect(config.save).toHaveBeenCalledOnce()
        title = '导出到文件'
        await service.buildMenu(pane)
        expect(service.getGroups()[0].label).toBe('导出到文件')
        expect(config.save).toHaveBeenCalledTimes(2)
        await service.buildMenu(pane)
        expect(config.save).toHaveBeenCalledTimes(2)
    })

    it('still opens menus if saving their discovered titles fails', async () => {
        const plugin = provider('l', [{ label: 'Actions' }])
        const { config, service, pane, warn } = setup([plugin])
        config.save.mockRejectedValue(new Error('read-only config'))
        expect(await service.buildMenu(pane)).toEqual([{ label: 'Actions' }])
        expect(service.getGroups()[0].label).toBe('Actions')
        expect(warn).toHaveBeenCalledWith('Failed to save menu titles', expect.any(Error))
    })

    it('keeps equally named minified providers in different plugins independently selectable', async () => {
        const first = provider('l', [{ label: 'Push Toolkit' }])
        const second = provider('l', [{ label: 'Other plugin' }])
        registerPlugins(
            { name: 'push-toolkit', tab: [first] },
            { name: 'other-plugin', tab: [second] },
        )
        const { config, service, pane } = setup([first, second])
        expect(service.getGroups()).toEqual([
            { id: 'tab:push-toolkit:0', label: 'Push Toolkit' },
            { id: 'tab:other-plugin:0', label: 'Other Plugin' },
        ])
        config.store.tmuxPlugin.excludedMenuProviders = ['tab:push-toolkit:0']
        expect(await service.buildMenu(pane)).toEqual([{ label: 'Other plugin' }])
        expect(first.getItems).not.toHaveBeenCalled()
        expect(second.getItems).toHaveBeenCalledOnce()
    })

    it('distinguishes equally named providers inside one plugin and across menu APIs', async () => {
        const first = provider('l', [{ label: 'First' }])
        const second = provider('l', [{ label: 'Second' }])
        const legacy = provider('l', [{ label: 'Legacy' }])
        const bridge = provider('LegacyContextMenu', [])
        registerPlugins(
            { name: 'terminal', tab: [bridge] },
            { name: 'tools', tab: [first, second], terminal: [legacy] },
        )
        const { config, service, pane } = setup([bridge, first, second], [legacy])
        expect(service.getGroups().map((group) => group.id)).toEqual([
            'terminal:tools:0',
            'tab:tools:0',
            'tab:tools:1',
        ])
        config.store.tmuxPlugin.excludedMenuProviders = ['tab:tools:0', 'terminal:tools:0']
        expect(await service.buildMenu(pane)).toEqual([{ label: 'Second' }])
        expect(first.getItems).not.toHaveBeenCalled()
        expect(legacy.getItems).not.toHaveBeenCalled()
    })

    it('retains readable names and exclusions after a restart or minification changes', async () => {
        const first = provider('l', [{ label: 'Push Toolkit' }])
        registerPlugins({ name: 'push-toolkit', tab: [first] })
        const { config, service, pane } = setup([first])
        await service.buildMenu(pane)
        config.store.tmuxPlugin.excludedMenuProviders = ['tab:push-toolkit:0']
        const rebuilt = provider('x', [{ label: 'Push Toolkit' }])
        registerPlugins({ name: 'push-toolkit', tab: [rebuilt] })
        const restarted = new TmuxMenuService(
            config as unknown as ConfigService,
            { create: () => ({ warn: vi.fn() }) } as unknown as LogService,
            [rebuilt],
            null,
        )
        expect(restarted.getGroups()).toEqual([{ id: 'tab:push-toolkit:0', label: 'Push Toolkit' }])
        expect(await restarted.buildMenu(pane)).toEqual([])
        expect(rebuilt.getItems).not.toHaveBeenCalled()
    })

    it('does not hide a third-party provider named like an excluded built-in', async () => {
        const plugin = provider('CopyPasteContextMenu', [{ label: 'Third party' }])
        registerPlugins({ name: 'third-party', tab: [plugin] })
        const { service, pane } = setup([plugin])
        expect(service.getGroups()).toEqual([{ id: 'tab:third-party:0', label: 'Third Party' }])
        expect(await service.buildMenu(pane)).toEqual([{ label: 'Third party' }])
    })

    it('keeps an uninstalled plugin readable and malformed saved IDs removable', () => {
        const { config, service } = setup([])
        config.store.tmuxPlugin.excludedMenuProviders = ['tab:push-toolkit:0', 'tab:%broken:0']
        expect(service.getGroups()).toEqual([
            { id: 'tab:push-toolkit:0', label: 'Push Toolkit' },
            { id: 'tab:%broken:0', label: '%Broken' },
        ])
    })

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
        expect(service.getGroups().find((group) => group.id === 'tab:unregistered:0')?.label).toBe(
            'Push Toolkit',
        )
        expect(service.getGroups().some((group) => group.id === 'tab:unregistered:1')).toBe(false)
    })

    it('hides built-in groups from both settings and pane menus', async () => {
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
        for (const saved of [undefined, []]) {
            config.store.tmuxPlugin.excludedMenuProviders = saved
            expect(await service.buildMenu(pane)).toEqual([{ label: 'Push Toolkit' }])
            expect(service.getGroups().map((group) => group.id)).toEqual(['tab:unregistered:10'])
        }
        for (const source of native) expect(source.getItems).not.toHaveBeenCalled()
    })

    it('applies changed exclusions to the next menu, without invoking an excluded plugin', async () => {
        const plugin = provider('PushContextMenuProvider', [{ label: 'Push Toolkit' }])
        const { config, service, pane } = setup([plugin])
        config.store.tmuxPlugin.excludedMenuProviders = ['tab:unregistered:0']
        expect(await service.buildMenu(pane)).toEqual([])
        expect(plugin.getItems).not.toHaveBeenCalled()
        expect(service.getGroups().some((group) => group.id === 'tab:unregistered:0')).toBe(true)
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
        expect(warn.mock.calls[0][0]).toContain('tab:unregistered:0')
    })

    it('exposes legacy plugins individually, without invoking the bridge or duplicating their menus', async () => {
        const bridge = provider('LegacyContextMenu', [{ label: 'Duplicate' }])
        const legacy = provider('LegacyUploadProvider', [{ label: 'Upload' }])
        const blocked = provider('LegacyBrokenProvider', [{ label: 'Broken' }])
        const { config, service, pane } = setup([bridge], [legacy, blocked])
        config.store.tmuxPlugin.excludedMenuProviders = ['terminal:unregistered:1']
        expect(await service.buildMenu(pane)).toEqual([{ label: 'Upload' }])
        expect(legacy.getItems).toHaveBeenCalledExactlyOnceWith(pane)
        expect(bridge.getItems).not.toHaveBeenCalled()
        expect(blocked.getItems).not.toHaveBeenCalled()
        expect(service.getGroups().map((group) => group.id)).toEqual([
            'terminal:unregistered:0',
            'terminal:unregistered:1',
        ])
    })

    it('respects globally disabled plugins and retains stale exclusions for editing', async () => {
        const disabled = provider('DisabledProvider', [{ label: 'Disabled' }])
        const { config, service, pane } = setup([disabled])
        config.enabledServices.mockReturnValue([])
        config.store.tmuxPlugin.excludedMenuProviders = ['tab:uninstalled:0']
        expect(await service.buildMenu(pane)).toEqual([])
        expect(disabled.getItems).not.toHaveBeenCalled()
        expect(service.getGroups().map((group) => group.id)).toEqual(['tab:uninstalled:0'])
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
        config.store.tmuxPlugin.excludedMenuProviders = ['tab:unregistered:0']
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
