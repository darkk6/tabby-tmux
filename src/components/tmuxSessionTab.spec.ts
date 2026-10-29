import { Subject } from 'rxjs'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('tabby-core', () => {
    class MockSplitTabComponent {
        disableDynamicTitle = false
        title = ''
        subscribeUntilDestroyed(
            observable: { subscribe: (callback: (...args: any[]) => void) => unknown },
            callback: (...args: any[]) => void,
        ): void {
            observable.subscribe(callback)
        }
        setTitle(title: string): void {
            this.title = title
        }
        ngOnDestroy(): void {
            /* base cleanup is irrelevant to these tests */
        }
    }
    return {
        SplitTabComponent: MockSplitTabComponent,
        SplitContainer: class SplitContainer {},
        HotkeysService: class HotkeysService {},
        TabRecoveryService: class TabRecoveryService {},
        TabsService: class TabsService {},
        LogService: class LogService {},
        ConfigService: class ConfigService {},
    }
})
vi.mock('tabby-terminal', () => ({ Frontend: class Frontend {} }))
vi.mock('../session', () => ({ TmuxController: class TmuxController {} }))
vi.mock('../services/tmux.service', () => ({ TmuxService: class TmuxService {} }))
vi.mock('../services/tmuxI18n.service', () => ({
    TmuxI18nService: class TmuxI18nService {},
}))
vi.mock('../gateway', () => ({ TMUX_COMMAND_TOLERATE_ERRORS: [] }))
vi.mock('./tmuxPaneTab.component', () => ({
    TmuxPaneTabComponent: class TmuxPaneTabComponent {},
}))
vi.mock('../layoutParser', () => ({
    flattenLayout: vi.fn(),
    parseTmuxLayout: vi.fn(),
}))
vi.mock('../divider', () => ({ renderDividers: vi.fn() }))
vi.mock('../tmuxKeymap', () => ({}))
vi.mock('../tmuxRename', () => ({ normalizeRename: vi.fn() }))

type SessionTabTitleState = {
    disableDynamicTitle: boolean
    title: string
    controller: unknown
    sessionName: string
    getCustomTitle(): string
}

type ControllerEvent = {
    type: string
    paneId?: number
    windowId?: number
    data?: unknown
}

type TestController = {
    events: Subject<ControllerEvent>
    gateway: { sendCommand: (...args: unknown[]) => Promise<string> }
    isAttached: boolean
    getActiveWindowId(): number | null
    getActivePaneId(windowId: number): number | null
    getHostName(): string
    getSessionName(): string
    getPaneTitle(paneId: number): string
    setActivePaneId(paneId: number): void
    setPaneTitle(paneId: number, title: string): void
    getAllWindowStates(): Array<{ id: number; name: string; panes: Set<number> }>
    getWindowState(windowId: number): { name: string; index?: number } | undefined
}

type SessionTabTestInstance = SessionTabTitleState & {
    activeWindowId: number | null
    controller: TestController
    existingController: TestController
    enqueueSwitchToWindow(windowId: number, syncToTmux?: boolean): void
    switchToWindow(windowId: number, syncToTmux?: boolean): Promise<void>
    ngOnInit(): void
}

type TestZone = {
    run(callback: () => void): void
}

describe('TmuxSessionTabComponent title ownership', () => {
    let SessionTabComponent: unknown

    beforeAll(async () => {
        SessionTabComponent = (await import('./tmuxSessionTab.component')).TmuxSessionTabComponent
    })

    function createSessionTab(format = '#{window_name} - #{host}'): {
        component: SessionTabTestInstance
        zone: TestZone
        controller: TestController
        configChanges: Subject<void>
    } {
        const languageChange$ = new Subject<void>()
        const hotkey$ = new Subject<string>()
        const controllerEvents = new Subject<ControllerEvent>()
        const injector = { get: () => ({}) }
        const i18n = {
            languageChange$,
            t: (key: string, params?: { name?: string }) =>
                params?.name ? `${key}:${params.name}` : key,
        }
        const hotkeys = { hotkey$, unfilteredHotkey$: new Subject<string>() }
        const zone: TestZone = { run: vi.fn((callback: () => void) => callback()) }
        const log = {
            create: () => ({
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            }),
        }
        const configChanges = new Subject<void>()
        let activePaneId = 9
        const paneTitles = new Map([[9, 'terminal']])
        const controller: TestController = {
            events: controllerEvents,
            gateway: { sendCommand: vi.fn().mockResolvedValue('') },
            isAttached: false,
            getActiveWindowId: () => 1,
            getActivePaneId: () => activePaneId,
            getHostName: () => 'host.example',
            getSessionName: () => 'session',
            getPaneTitle: (paneId) => paneTitles.get(paneId) ?? '',
            setActivePaneId: (paneId) => {
                activePaneId = paneId
            },
            setPaneTitle: (paneId, title) => {
                paneTitles.set(paneId, title)
            },
            getAllWindowStates: () => [],
            getWindowState: (windowId) =>
                windowId === 1 ? { name: 'editor', index: 2 } : { name: 'shell', index: 3 },
        }
        const config = { store: { tmuxPlugin: { sessionTitleFormat: format } } }
        const SessionTab = SessionTabComponent as new (...args: unknown[]) => SessionTabTestInstance
        const component = new SessionTab(
            injector,
            {},
            i18n,
            config,
            {},
            { detectChanges: vi.fn() },
            {},
            hotkeys,
            zone,
            { changed$: configChanges },
            log,
        )
        component.controller = controller
        component.existingController = controller
        component.sessionName = 'session'
        component.activeWindowId = 1
        return { component, zone, controller, configChanges }
    }

    it('keeps the session title as the parent SplitTab title owner', () => {
        const { component } = createSessionTab()

        expect(component.disableDynamicTitle).toBe(true)
    })

    it('mounts the ready active window without waiting for background discovery', async () => {
        const { component, controller } = createSessionTab()
        const internal = component as SessionTabTestInstance & {
            _initialized: boolean
            eventQueue: Promise<void>
        }
        component.activeWindowId = null
        internal._initialized = true
        component.ngOnInit()
        const switching = vi.spyOn(component, 'switchToWindow').mockResolvedValue(undefined)
        controller.events.next({ type: 'window-add', windowId: 2, data: { deferSwitch: true } })
        controller.events.next({
            type: 'layout-change',
            windowId: 2,
            data: { layout: 'background' },
        })
        await internal.eventQueue
        expect(switching).not.toHaveBeenCalled()
        controller.events.next({ type: 'layout-change', windowId: 1, data: { layout: 'active' } })
        await internal.eventQueue
        expect(switching).toHaveBeenCalledWith(1)
    })

    it('renders the configured window, pane, session and host variables', () => {
        const { component } = createSessionTab(
            '#{session_name}: #{window_name} #{window_id}/#{window_index} #{pane_name} #{pane_id} #{host}',
        )

        expect(component.getCustomTitle()).toBe('session: editor @1/2 terminal %9 host.example')
    })

    it('refreshes the title when the format configuration changes', () => {
        const { component, configChanges } = createSessionTab()
        const config = (component as any).configService as {
            store: { tmuxPlugin: { sessionTitleFormat: string } }
        }
        config.store.tmuxPlugin.sessionTitleFormat = '#{session_name} / #{window_name}'

        configChanges.next()

        expect(component.title).toBe('session / editor')
    })

    it('refreshes the configured pane variables on active pane changes', () => {
        const { component, controller } = createSessionTab(
            '#{window_name} / #{pane_name} #{pane_id}',
        )
        component.ngOnInit()

        controller.setActivePaneId(10)
        controller.setPaneTitle(10, 'logs')
        controller.events.next({ type: 'active-pane-changed', windowId: 1, paneId: 10 })

        expect(component.title).toBe('editor / logs %10')
    })

    it('updates the pane title after a pane rename event', () => {
        const { component, controller } = createSessionTab('#{window_name} / #{pane_name}')
        component.ngOnInit()

        controller.setPaneTitle(9, 'renamed')
        controller.events.next({ type: 'pane-renamed', windowId: 1, paneId: 9 })

        expect(component.title).toBe('editor / renamed')
    })

    it('updates the title before a queued window view switch completes', async () => {
        const { component, zone } = createSessionTab()
        const switchSpy = vi.spyOn(component, 'switchToWindow').mockResolvedValue(undefined)

        component.enqueueSwitchToWindow(2, true)

        expect(component.title).toBe('shell - host.example')
        expect(component.getCustomTitle()).toBe('shell - host.example')
        expect(zone.run).toHaveBeenCalled()

        await Promise.resolve()
        expect(switchSpy).toHaveBeenCalledWith(2, true)
    })
})

describe('TmuxSessionTabComponent pane profile', () => {
    it('forwards the host profile to every pane tab it creates', async () => {
        const { TmuxSessionTabComponent: SessionTab } = await import('./tmuxSessionTab.component')
        const hostProfile = { name: 'ssh', terminalColorScheme: { name: 'Solarized' } }
        const create = vi.fn(() => ({}))
        const tab = Object.create(SessionTab.prototype)
        tab.controller = { id: 'controller' }
        tab.hostProfile = hostProfile
        tab._tabsService = { create }
        tab.logger = { info: vi.fn() }

        tab.createPaneTab(7)

        expect(create).toHaveBeenCalledWith({
            type: expect.anything(),
            inputs: { controller: tab.controller, paneId: 7, hostProfile },
        })
    })
})

describe('TmuxSessionTabComponent pane area background', () => {
    it('uses the host terminal background, or none without a scheme', async () => {
        const { TmuxSessionTabComponent: SessionTab } = await import('./tmuxSessionTab.component')
        const tab = Object.create(SessionTab.prototype)

        tab.hostProfile = { terminalColorScheme: { background: '#101010' } }
        expect(tab.paneAreaBackground).toBe('#101010')

        tab.hostProfile = null
        expect(tab.paneAreaBackground).toBeNull()
    })
})

describe('TmuxSessionTabComponent tmux prefix key', () => {
    type FakeEvent = {
        key: string
        code: string
        ctrlKey: boolean
        altKey: boolean
        shiftKey: boolean
        metaKey: boolean
        repeat: boolean
        isComposing: boolean
        keyCode: number
        target: unknown
        preventDefault: ReturnType<typeof vi.fn>
        stopPropagation: ReturnType<typeof vi.fn>
        stopImmediatePropagation: ReturnType<typeof vi.fn>
    }

    const paneNode = { inPane: true }
    const barNode = { inPane: false }

    function keyEvent(key: string, options: Partial<Omit<FakeEvent, 'key'>> = {}): FakeEvent {
        return {
            key,
            code: `Key${key.toUpperCase()}`,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
            repeat: false,
            isComposing: false,
            keyCode: 0,
            target: paneNode,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            stopImmediatePropagation: vi.fn(),
            ...options,
        }
    }

    type PrefixTab = {
        prefixPending: boolean
        prefixKey: string
        prefixOverlayStyle: string
        confirmRequest: { message: string; onConfirm: () => void } | null
        controller: unknown
        existingController: unknown
        activeWindowId: number | null
        getFocusedTab: () => unknown
        ngOnInit(): void
        ngOnDestroy(): void
        handlePrefixKeydown(event: unknown): void
        resolveConfirm(accepted: boolean): void
        switchWindowByOffset: ReturnType<typeof vi.fn>
        enqueueSwitchToWindow: ReturnType<typeof vi.fn>
        onCreateWindow: ReturnType<typeof vi.fn>
        onDisconnect: ReturnType<typeof vi.fn>
        onWindowClose: ReturnType<typeof vi.fn>
        requestWindowRename: ReturnType<typeof vi.fn>
        navigate: ReturnType<typeof vi.fn>
        navigateLinear: ReturnType<typeof vi.fn>
        handlePaneMaximizeHotkey: ReturnType<typeof vi.fn>
    }

    async function createPrefixTab(config: Record<string, unknown> = {}): Promise<{
        tab: PrefixTab
        host: {
            addEventListener: ReturnType<typeof vi.fn>
            removeEventListener: ReturnType<typeof vi.fn>
        }
        pane: { paneId: number; sendInput: ReturnType<typeof vi.fn> }
        controller: {
            killPane: ReturnType<typeof vi.fn>
            splitWindow: ReturnType<typeof vi.fn>
            getAllWindowStates: () => Array<{ id: number; name: string; index?: number }>
            getWindowState: (id: number) => { name: string } | undefined
        }
        listener: (event: unknown) => void
    }> {
        const { TmuxSessionTabComponent: SessionTab } = await import('./tmuxSessionTab.component')
        const { TmuxPaneTabComponent: PaneTab } = await import('./tmuxPaneTab.component')
        const paneArea = { contains: (node: { inPane?: boolean }) => node?.inPane === true }
        const host = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            querySelector: (selector: string) => (selector === '.pane-area' ? paneArea : null),
        }
        const PaneTabCtor = PaneTab as unknown as new () => object
        const pane = Object.assign(new PaneTabCtor(), { paneId: 9, sendInput: vi.fn() })
        const controller = {
            events: new Subject<ControllerEvent>(),
            gateway: { sendCommand: vi.fn().mockResolvedValue('') },
            isAttached: false,
            getSessionName: () => 'session',
            getHostName: () => 'host.example',
            getActiveWindowId: () => 11,
            getActivePaneId: () => 9,
            getPaneTitle: () => 'terminal',
            killPane: vi.fn().mockResolvedValue(undefined),
            splitWindow: vi.fn().mockResolvedValue(undefined),
            getAllWindowStates: () => [
                { id: 11, name: 'shell', index: 0, panes: new Set<number>([9]) },
                { id: 12, name: 'build', index: 3, panes: new Set<number>() },
            ],
            getWindowState: (id: number) =>
                id === 11 ? { name: 'shell', panes: new Set<number>([9]) } : undefined,
        }
        const SessionTabCtor = SessionTab as unknown as new (...args: unknown[]) => PrefixTab
        const tab = new SessionTabCtor(
            { get: () => ({}) },
            {},
            { languageChange$: new Subject<void>(), t: (key: string) => key },
            { store: { tmuxPlugin: { sessionTitleFormat: '#{window_name}', ...config } } },
            {},
            { detectChanges: vi.fn() },
            { nativeElement: host },
            { hotkey$: new Subject<string>(), unfilteredHotkey$: new Subject<string>() },
            { run: (callback: () => void) => callback() },
            { changed$: new Subject<void>() },
            { create: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
        )
        tab.existingController = controller
        tab.activeWindowId = 11
        tab.getFocusedTab = () => pane
        for (const method of [
            'switchWindowByOffset',
            'enqueueSwitchToWindow',
            'onCreateWindow',
            'onDisconnect',
            'onWindowClose',
            'requestWindowRename',
            'navigate',
            'navigateLinear',
            'handlePaneMaximizeHotkey',
        ] as const) {
            tab[method] = vi.fn()
        }
        // ngOnInit also bootstraps pane tabs through TabsService; only the
        // listener installation is under test here.
        tab.controller = controller
        ;(tab as unknown as { installPrefixKeyListener(): void }).installPrefixKeyListener()
        const call = host.addEventListener.mock.calls.find((args) => args[0] === 'keydown')
        expect(call?.[2]).toBe(true) // capture phase
        return { tab, host, pane, controller, listener: call?.[1] as (event: unknown) => void }
    }

    it('reads the prefix and overlay style from config with safe fallbacks', async () => {
        const defaults = await createPrefixTab()
        expect(defaults.tab.prefixKey).toBe('Ctrl-B')
        expect(defaults.tab.prefixOverlayStyle).toBe('bar')

        const custom = await createPrefixTab({ prefixKey: 'Ctrl-A', prefixOverlayStyle: 'modal' })
        expect(custom.tab.prefixKey).toBe('Ctrl-A')
        expect(custom.tab.prefixOverlayStyle).toBe('modal')

        const broken = await createPrefixTab({ prefixKey: 'B', prefixOverlayStyle: 'huge' })
        expect(broken.tab.prefixKey).toBe('Ctrl-B')
        expect(broken.tab.prefixOverlayStyle).toBe('bar')
    })

    it('arms the prefix only for the configured key inside the pane area', async () => {
        const { tab, listener } = await createPrefixTab()

        const outside = keyEvent('b', { ctrlKey: true, target: barNode })
        listener(outside)
        expect(tab.prefixPending).toBe(false)
        expect(outside.preventDefault).not.toHaveBeenCalled()

        const plain = keyEvent('b')
        listener(plain)
        expect(tab.prefixPending).toBe(false)
        expect(plain.preventDefault).not.toHaveBeenCalled()

        const prefix = keyEvent('b', { ctrlKey: true })
        listener(prefix)
        expect(tab.prefixPending).toBe(true)
        expect(prefix.preventDefault).toHaveBeenCalled()
        expect(prefix.stopPropagation).toHaveBeenCalled()
    })

    it('ignores auto-repeat and IME composition', async () => {
        const { tab, listener } = await createPrefixTab()
        listener(keyEvent('b', { ctrlKey: true, repeat: true }))
        expect(tab.prefixPending).toBe(false)
        listener(keyEvent('b', { ctrlKey: true, isComposing: true }))
        expect(tab.prefixPending).toBe(false)
    })

    it('dispatches the second key to the plugin action and closes', async () => {
        const { tab, listener } = await createPrefixTab()
        listener(keyEvent('b', { ctrlKey: true }))

        const next = keyEvent('n', { ctrlKey: true }) // Ctrl still held
        listener(next)
        expect(tab.switchWindowByOffset).toHaveBeenCalledWith(1)
        expect(tab.prefixPending).toBe(false)
        expect(next.preventDefault).toHaveBeenCalled()

        // Not pending any more: the next key is ordinary terminal input.
        const typed = keyEvent('c')
        listener(typed)
        expect(typed.preventDefault).not.toHaveBeenCalled()
        expect(tab.onCreateWindow).not.toHaveBeenCalled()
    })

    it('keeps waiting through bare modifier keydowns', async () => {
        const { tab, listener } = await createPrefixTab()
        listener(keyEvent('b', { ctrlKey: true }))
        const ctrl = keyEvent('Control', { code: 'ControlLeft', ctrlKey: true })
        listener(ctrl)
        expect(tab.prefixPending).toBe(true)
        expect(ctrl.preventDefault).not.toHaveBeenCalled()
    })

    it('swallows and cancels on Escape or an unsupported key', async () => {
        const { tab, listener } = await createPrefixTab()
        for (const key of ['Escape', 'q']) {
            listener(keyEvent('b', { ctrlKey: true }))
            const event = keyEvent(key)
            listener(event)
            expect(tab.prefixPending).toBe(false)
            expect(event.preventDefault).toHaveBeenCalled()
        }
        expect(tab.switchWindowByOffset).not.toHaveBeenCalled()
        expect(tab.onCreateWindow).not.toHaveBeenCalled()
    })

    it('selects a window by tmux index, not by tab position', async () => {
        const { tab, listener } = await createPrefixTab()
        listener(keyEvent('b', { ctrlKey: true }))
        listener(keyEvent('3', { code: 'Digit3' }))
        expect(tab.enqueueSwitchToWindow).toHaveBeenCalledWith(12, true)

        listener(keyEvent('b', { ctrlKey: true }))
        listener(keyEvent('1', { code: 'Digit1' }))
        expect(tab.enqueueSwitchToWindow).toHaveBeenCalledTimes(1)
    })

    it('sends the raw prefix key to the pane on prefix prefix', async () => {
        const { listener, pane } = await createPrefixTab({ prefixKey: 'Ctrl-A' })
        listener(keyEvent('a', { ctrlKey: true }))
        listener(keyEvent('a', { ctrlKey: true }))
        expect(pane.sendInput).toHaveBeenCalledTimes(1)
        expect([...pane.sendInput.mock.calls[0][0]]).toEqual([0x01])
    })

    it('routes pane and session actions to the existing methods', async () => {
        const { tab, listener, controller } = await createPrefixTab()
        const press = (key: string, options: Partial<Omit<FakeEvent, 'key'>> = {}) => {
            listener(keyEvent('b', { ctrlKey: true }))
            listener(keyEvent(key, options))
        }
        press('%')
        expect(controller.splitWindow).toHaveBeenCalledWith(9, 'r')
        press('"')
        expect(controller.splitWindow).toHaveBeenCalledWith(9, 'b')
        press('ArrowLeft', { code: 'ArrowLeft' })
        expect(tab.navigate).toHaveBeenCalledWith('l')
        press('o')
        expect(tab.navigateLinear).toHaveBeenCalledWith(1)
        press('z')
        expect(tab.handlePaneMaximizeHotkey).toHaveBeenCalled()
        press('d')
        expect(tab.onDisconnect).toHaveBeenCalled()
        press(',')
        expect(tab.requestWindowRename).toHaveBeenCalledWith({ id: 11, name: 'shell' })
        press('c')
        expect(tab.onCreateWindow).toHaveBeenCalled()
        press('p')
        expect(tab.switchWindowByOffset).toHaveBeenCalledWith(-1)
    })

    it('asks for confirmation before killing a pane or a window', async () => {
        vi.useFakeTimers()
        try {
            const { tab, listener, controller } = await createPrefixTab()
            listener(keyEvent('b', { ctrlKey: true }))
            listener(keyEvent('x'))
            expect(controller.killPane).not.toHaveBeenCalled()
            expect(tab.confirmRequest?.message).toBe('confirm.killPane')
            tab.resolveConfirm(false)
            expect(tab.confirmRequest).toBeNull()
            expect(controller.killPane).not.toHaveBeenCalled()

            listener(keyEvent('b', { ctrlKey: true }))
            listener(keyEvent('x'))
            tab.resolveConfirm(true)
            expect(controller.killPane).toHaveBeenCalledWith(9)

            listener(keyEvent('b', { ctrlKey: true }))
            listener(keyEvent('&'))
            expect(tab.confirmRequest?.message).toBe('confirm.killWindow')
            tab.resolveConfirm(true)
            expect(tab.onWindowClose).toHaveBeenCalledWith(11)
            vi.runAllTimers()
        } finally {
            vi.useRealTimers()
        }
    })

    it('removes the capture listener on destroy', async () => {
        const { tab, host, listener } = await createPrefixTab()
        listener(keyEvent('b', { ctrlKey: true }))
        tab.ngOnDestroy()
        expect(tab.prefixPending).toBe(false)
        expect(host.removeEventListener).toHaveBeenCalledWith('keydown', listener, true)
    })
})
