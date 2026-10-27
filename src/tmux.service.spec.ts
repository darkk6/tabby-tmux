import { describe, expect, it, vi } from 'vitest'
import { Subject } from 'rxjs'
import type { AppService, ConfigService, HotkeysService, LogService, Logger } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { TmuxSessionTabComponent } from './components/tmuxSessionTab.component'
import { TmuxService, SessionContext, TmuxOutputInterceptor } from './services/tmux.service'

// tabby-core / tabby-terminal / tabby components are Angular partially-compiled
// packages; loading them in Node requires the Angular linker. Stub them so the
// test exercises TmuxService's real logic without pulling in the UI graph.
vi.mock('tabby-core', async () => {
    const { Injectable } = await import('@angular/core')
    return {
        Injectable,
        AppService: class AppService {},
        LogService: class LogService {},
        Logger: class Logger {},
        ConfigService: class ConfigService {},
        HotkeysService: class HotkeysService {},
    }
})

vi.mock('tabby-terminal', async () => {
    const { Subject } = await import('rxjs')
    class MockBaseSession {
        open = false
        output$ = new Subject<Buffer>()
        constructor(_logger: unknown) {
            this.open = true
        }
        protected emitOutput(data: Buffer): void {
            this.output$.next(data)
        }
        async destroy(): Promise<void> {
            this.output$.complete()
        }
    }
    class MockSessionMiddleware {
        outputToTerminal$ = new Subject<Buffer>()
        feedFromSession(data: Buffer): void {
            this.outputToTerminal$.next(data)
        }
        close(): void {
            this.outputToTerminal$.complete()
        }
        push(): void {
            void 0
        }
        unshift(): void {
            void 0
        }
        remove(): void {
            void 0
        }
    }
    return {
        BaseSession: MockBaseSession,
        SessionMiddleware: MockSessionMiddleware,
        BaseTerminalTabComponent: class BaseTerminalTabComponent {},
    }
})

vi.mock('./components/tmuxSessionTab.component', () => ({
    TmuxSessionTabComponent: class TmuxSessionTabComponent {},
}))

function createLoggerMock() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } as unknown as Logger
}

/** NgZone mock that records whether its callback runs "inside the zone". */
function createZoneMock() {
    let insideZone = false
    const zone = {
        run: vi.fn((fn: () => void) => {
            insideZone = true
            try {
                return fn()
            } finally {
                insideZone = false
            }
        }),
        isInsideZone: () => insideZone,
    }
    return zone
}

function createService() {
    const tabs: any[] = []
    const tabsChanged = new Subject<void>()
    const openNewTabRaw = vi.fn((params: any) => {
        const tab = Object.assign(Object.create(TmuxSessionTabComponent.prototype), {
            destroyed$: new Subject(),
            destroy: vi.fn(),
            ...params.inputs,
            // Record whether the tab was created inside the Angular zone
            createdInsideZone: zone.isInsideZone(),
        })
        tabs.push(tab)
        ;(appService as any).activeTab = tab
        return tab
    })
    const selectTab = vi.fn((tab) => {
        ;(appService as any).activeTab = tab
    })
    const appService = {
        tabs,
        tabsChanged,
        openNewTabRaw,
        selectTab,
        activeTab: null,
    } as unknown as AppService

    const zone = createZoneMock()
    const logger = createLoggerMock()
    const configService = {
        store: { tmuxPlugin: { debugLogging: true } },
    } as unknown as ConfigService
    const logService = { create: () => logger } as unknown as LogService
    const hotkeysService = {
        unfilteredHotkey$: new Subject<string>(),
    } as unknown as HotkeysService

    const service = new TmuxService(
        {} as any, // Injector — unused by the paths under test
        appService,
        configService,
        zone as any,
        logService,
        hotkeysService,
    )
    return {
        service,
        appService,
        zone,
        tabs,
        openNewTabRaw,
        selectTab,
        logger,
        hotkeysService,
        configService,
    }
}

function createContext(topmostParent?: any): SessionContext {
    const terminalTab = {
        topmostParent: topmostParent ?? null,
        session: { middleware: { unshift: vi.fn(), remove: vi.fn() } },
        destroyed$: new Subject(),
        frontend: {},
    } as any
    const context: SessionContext = {
        controller: {
            getSessionName: () => 'main',
            gateway: { detach: vi.fn() },
            destroy: vi.fn().mockResolvedValue(undefined),
        } as any,
        terminalTab,
        subscriptions: [],
    }
    return context
}

describe('TmuxService', () => {
    describe('replaceWithSessionTab', () => {
        it('creates the session tab inside the Angular zone', () => {
            const { service, zone, openNewTabRaw } = createService()
            const context = createContext()

            ;(service as any).replaceWithSessionTab(context)

            expect(zone.run).toHaveBeenCalled()
            expect(openNewTabRaw).toHaveBeenCalled()
            // The tab instance must be created while zone.run is executing,
            // otherwise Angular change detection never fires and the tab
            // component stays unmounted until an unrelated zone event.
            expect(openNewTabRaw.mock.results[0].value.createdInsideZone).toBe(true)
        })

        it('swaps the session tab in place of the original topmost tab', () => {
            const { service, appService, tabs } = createService()
            const originalTab = { name: 'original' }
            const context = createContext(originalTab)
            ;(appService as any).tabs.push(originalTab)

            ;(service as any).replaceWithSessionTab(context)

            // Session tab sits at the original tab's index; original is hidden
            expect(tabs).toHaveLength(1)
            expect(tabs[0]).not.toBe(originalTab)
            expect(context.sessionTab).toBeDefined()
            expect((context.sessionTab as any)?.createdInsideZone).toBe(true)
        })

        it('passes the host terminal profile to the session tab', () => {
            const { service, tabs } = createService()
            const context = createContext()
            const hostProfile = { name: 'ssh', terminalColorScheme: { name: 'Solarized' } }
            Object.assign(context.terminalTab, { profile: hostProfile })

            ;(service as any).replaceWithSessionTab(context)

            expect(tabs[0].hostProfile).toBe(hostProfile)
        })

        it.each([false, true])(
            'keeps the second tab active when the first attach initializes late (second initialized: %s)',
            async (secondInitialized) => {
                const { service, appService, tabs } = createService()
                const firstOriginal = { name: 'first' }
                const secondTerminal = Object.create(BaseTerminalTabComponent.prototype)
                const secondOriginal = { name: 'second', focusedTab: secondTerminal }
                const first = createContext(firstOriginal)
                const second = createContext(secondOriginal)
                ;(service as any).sessions.add(first)
                ;(service as any).sessions.add(second)
                tabs.push(firstOriginal, secondOriginal)
                ;(appService as any).activeTab = secondOriginal
                if (secondInitialized) {
                    ;(service as any).replaceWithSessionTab(second)
                }
                const activeBefore = appService.activeTab

                ;(service as any).replaceWithSessionTab(first)

                expect(appService.activeTab).toBe(activeBefore)
                expect(tabs).toEqual([first.sessionTab, second.sessionTab ?? secondOriginal])

                const attach = vi.spyOn(service, 'attachToTerminal').mockResolvedValue(undefined)
                const detach = vi.spyOn(service, 'disconnectContext').mockResolvedValue(undefined)
                await service.toggleTmuxMode()
                if (secondInitialized) {
                    expect(detach).toHaveBeenCalledExactlyOnceWith(second)
                    expect(attach).not.toHaveBeenCalled()
                } else {
                    expect(attach).toHaveBeenCalledExactlyOnceWith(secondTerminal)
                    expect(detach).not.toHaveBeenCalled()
                }
            },
        )
    })

    describe('disconnectContext', () => {
        it('bounds both hotkey and direct reattach waits and permits retry after a late DCS end', async () => {
            vi.useFakeTimers()
            try {
                const { service, appService, configService, logger } = createService()
                configService.store.tmuxPlugin.commandTimeoutMs = 25
                const context = createContext()
                Object.setPrototypeOf(context.terminalTab, BaseTerminalTabComponent.prototype)
                const session = context.terminalTab.session
                session.write = vi.fn()
                const interceptor = new TmuxOutputInterceptor()
                context.outputInterceptor = interceptor
                interceptor.feedFromSession(Buffer.from('\x1bP1000p'))
                await service.disconnectContext(context)
                ;(appService as any).activeTab = context.terminalTab

                const hotkey = service.toggleTmuxMode()
                const menu = service.attachToTerminal(context.terminalTab)
                await vi.advanceTimersByTimeAsync(25)
                await Promise.all([hotkey, menu])

                expect(logger.warn).toHaveBeenCalledTimes(2)
                expect(session.write).not.toHaveBeenCalled()
                expect(session.middleware.remove).not.toHaveBeenCalled()
                interceptor.feedFromSession(Buffer.from('%exit\r\n\x1b\\'))
                await service.toggleTmuxMode()
                expect(session.write).toHaveBeenCalledOnce()
                expect(vi.getTimerCount()).toBe(0)

                const nextInterceptor = vi.mocked(session.middleware.unshift).mock
                    .calls[0][0] as TmuxOutputInterceptor
                nextInterceptor.feedFromSession(Buffer.from('\x1bP1000p'))
                await service.disconnect()
                nextInterceptor.feedFromSession(Buffer.from('%exit\r\n\x1b\\'))
                await nextInterceptor.controlModeEnded
            } finally {
                vi.useRealTimers()
            }
        })

        it('waits for the previous Control Mode to end before reattaching the same terminal', async () => {
            const { service } = createService()
            const context = createContext()
            const session = context.terminalTab.session
            session.write = vi.fn()
            const interceptor = new TmuxOutputInterceptor()
            context.outputInterceptor = interceptor
            interceptor.feedFromSession(Buffer.from('\x1bP1000p'))
            await service.disconnectContext(context)

            const first = service.attachToTerminal(context.terminalTab)
            const second = service.attachToTerminal(context.terminalTab)
            expect(session.write).not.toHaveBeenCalled()
            expect(session.middleware.unshift).not.toHaveBeenCalled()
            interceptor.feedFromSession(Buffer.from('%exit\r\n\x1b\\shell$ '))
            await Promise.all([first, second])
            expect(session.write).toHaveBeenCalledTimes(1)
            expect(session.middleware.unshift).toHaveBeenCalledOnce()
            const remove = vi.mocked(session.middleware.remove)
            const unshift = vi.mocked(session.middleware.unshift)
            expect(remove.mock.invocationCallOrder[0]).toBeLessThan(
                unshift.mock.invocationCallOrder[0],
            )

            const nextInterceptor = unshift.mock.calls[0][0] as TmuxOutputInterceptor
            nextInterceptor.feedFromSession(Buffer.from('\x1bP1000p'))
            await service.disconnect()
            nextInterceptor.feedFromSession(Buffer.from('%exit\r\n\x1b\\'))
            await nextInterceptor.controlModeEnded
        })
        it('keeps protocol output intercepted until the DCS ends and preserves the shell prompt', async () => {
            const { service } = createService()
            const context = createContext()
            const interceptor = new TmuxOutputInterceptor()
            context.outputInterceptor = interceptor
            interceptor.feedFromSession(Buffer.from('\x1bP1000p'))
            const output: string[] = []
            interceptor.outputToTerminal$.subscribe((data) => output.push(data.toString()))
            await service.disconnectContext(context)
            const remove = context.terminalTab.session.middleware.remove
            expect(remove).not.toHaveBeenCalled()
            interceptor.feedFromSession(
                Buffer.from('%begin 1 1 1\nremaining history\n%end 1 1 1\n'),
            )
            expect(output).toEqual([])
            interceptor.feedFromSession(Buffer.from('%exit\r\n\x1b'))
            expect(remove).not.toHaveBeenCalled()
            interceptor.feedFromSession(Buffer.from('\\shell$ '))
            await interceptor.controlModeEnded
            expect(output.join('')).toBe('shell$ ')
            expect(remove).toHaveBeenCalledWith(interceptor)
        })
        it('restores the original topmost tab inside the Angular zone', async () => {
            const { service, zone, selectTab, tabs } = createService()
            const originalTab = { name: 'original' }
            const context = createContext(originalTab)
            ;(service as any).replaceWithSessionTab(context)
            // Session tab is now the only tab; simulate the original being
            // hidden (removed from app.tabs) as replaceWithSessionTab does.
            const sessionTab = context.sessionTab!
            expect(tabs).toContain(sessionTab)

            await (service as any).disconnectContext(context)

            expect(zone.run).toHaveBeenCalled()
            expect(tabs).toContain(originalTab)
            expect(selectTab).toHaveBeenCalledWith(originalTab)
        })

        it.each([false, true])(
            'preserves the selected tab when disconnect finishes (switched during cleanup: %s)',
            async (switchDuringCleanup) => {
                const { service, appService, selectTab, tabs } = createService()
                const originalTab = { name: 'original' }
                const otherTab = { name: 'other' }
                const context = createContext(originalTab)
                ;(service as any).replaceWithSessionTab(context)
                tabs.push(otherTab)
                selectTab.mockClear()
                let finishCleanup: (() => void) | undefined
                vi.mocked(context.controller.destroy).mockImplementation(
                    () =>
                        new Promise<void>((resolve) => {
                            finishCleanup = resolve
                        }),
                )
                if (!switchDuringCleanup) {
                    ;(appService as any).activeTab = otherTab
                }

                const disconnect = service.disconnectContext(context)
                ;(appService as any).activeTab = otherTab
                finishCleanup?.()
                await disconnect

                expect(tabs).toContain(originalTab)
                expect(appService.activeTab).toBe(otherTab)
                expect(selectTab).not.toHaveBeenCalled()
            },
        )

        it('disconnects when Tabby destroys the session tab directly', async () => {
            const { service, tabs } = createService()
            const originalTab = { name: 'original' }
            const context = createContext(originalTab)
            ;(service as any).replaceWithSessionTab(context)

            const sessionTab = context.sessionTab!
            ;(sessionTab.destroyed$ as Subject<void>).next()
            await new Promise((resolve) => setTimeout(resolve, 0))

            expect(context.controller.gateway.detach).toHaveBeenCalledOnce()
            expect(context.controller.destroy).toHaveBeenCalledOnce()
            expect(context.disconnecting).toBe(true)
            expect(tabs).toContain(originalTab)
        })
    })

    describe('toggleTmuxMode', () => {
        it('attaches from the active terminal tab when idle', () => {
            const { service, appService } = createService()
            const attachSpy = vi.spyOn(service, 'attachToTerminal').mockResolvedValue(undefined)
            const terminal = Object.create(BaseTerminalTabComponent.prototype)
            ;(appService as any).activeTab = terminal

            service.toggleTmuxMode()

            expect(attachSpy).toHaveBeenCalledWith(terminal)
        })

        it('attaches from the active terminal while another tab is connected', async () => {
            const { service, appService, selectTab } = createService()
            const context = createContext()
            ;(service as any).sessions.add(context)
            const terminal = Object.create(BaseTerminalTabComponent.prototype)
            ;(appService as any).activeTab = { focusedTab: terminal }
            const attachSpy = vi.spyOn(service, 'attachToTerminal').mockResolvedValue(undefined)

            await service.toggleTmuxMode()

            expect(attachSpy).toHaveBeenCalledWith(terminal)
            expect(context.controller.gateway.detach).not.toHaveBeenCalled()
            expect(selectTab).not.toHaveBeenCalled()
        })

        it.each([false, true])(
            'disconnects only the active tmux session (wrapped: %s)',
            async (wrapped) => {
                const { service, appService, selectTab } = createService()
                const inactive = createContext({ name: 'inactive' })
                const active = createContext({ name: 'active' })
                active.topmostTab = active.terminalTab.topmostParent
                active.sessionTab = Object.create(TmuxSessionTabComponent.prototype)
                active.sessionTab.destroy = vi.fn().mockResolvedValue(undefined)
                ;(service as any).sessions.add(inactive)
                ;(service as any).sessions.add(active)
                ;(appService as any).activeTab = wrapped
                    ? { focusedTab: active.sessionTab }
                    : active.sessionTab

                await service.toggleTmuxMode()

                expect(active.controller.gateway.detach).toHaveBeenCalledOnce()
                expect(selectTab).toHaveBeenCalledExactlyOnceWith(active.topmostTab)
                expect(inactive.controller.gateway.detach).not.toHaveBeenCalled()
                expect(service.isConnected).toBe(true)
            },
        )

        it('does not attach to a pane inside an unowned tmux session tab', async () => {
            const { service, appService } = createService()
            const attachSpy = vi.spyOn(service, 'attachToTerminal').mockResolvedValue(undefined)
            const sessionTab = Object.create(TmuxSessionTabComponent.prototype)
            sessionTab.focusedTab = Object.create(BaseTerminalTabComponent.prototype)
            ;(appService as any).activeTab = sessionTab

            await service.toggleTmuxMode()

            expect(attachSpy).not.toHaveBeenCalled()
        })

        it('ignores repeated toggles while detaching and permits the next toggle', async () => {
            const { service, appService } = createService()
            const context = createContext()
            context.sessionTab = Object.create(TmuxSessionTabComponent.prototype)
            ;(service as any).sessions.add(context)
            ;(appService as any).activeTab = context.sessionTab
            let finishDisconnect: (() => void) | undefined
            const disconnectSpy = vi.spyOn(service, 'disconnectContext').mockImplementation(
                () =>
                    new Promise<void>((resolve) => {
                        finishDisconnect = resolve
                    }),
            )
            const attachSpy = vi.spyOn(service, 'attachToTerminal').mockResolvedValue(undefined)

            const first = service.toggleTmuxMode()
            const terminal = context.terminalTab
            Object.setPrototypeOf(terminal, BaseTerminalTabComponent.prototype)
            ;(appService as any).activeTab = terminal
            await service.toggleTmuxMode()

            expect(disconnectSpy).toHaveBeenCalledOnce()
            expect(attachSpy).not.toHaveBeenCalled()
            finishDisconnect?.()
            await first
            await service.toggleTmuxMode()
            expect(attachSpy).toHaveBeenCalledExactlyOnceWith(terminal)
        })

        it('allows another terminal to toggle while the first terminal is waiting to detach', async () => {
            const { service, appService } = createService()
            const context = createContext()
            context.sessionTab = Object.create(TmuxSessionTabComponent.prototype)
            ;(service as any).sessions.add(context)
            ;(appService as any).activeTab = context.sessionTab
            let finishDisconnect: (() => void) | undefined
            vi.spyOn(service, 'disconnectContext').mockImplementation(
                () =>
                    new Promise<void>((resolve) => {
                        finishDisconnect = resolve
                    }),
            )
            const attachSpy = vi.spyOn(service, 'attachToTerminal').mockResolvedValue(undefined)

            const first = service.toggleTmuxMode()
            const otherTerminal = Object.create(BaseTerminalTabComponent.prototype)
            ;(appService as any).activeTab = otherTerminal
            await service.toggleTmuxMode()

            expect(attachSpy).toHaveBeenCalledExactlyOnceWith(otherTerminal)
            finishDisconnect?.()
            await first
        })

        it('attaches from a terminal nested inside the active split tab', () => {
            const { service, appService } = createService()
            const attachSpy = vi.spyOn(service, 'attachToTerminal').mockResolvedValue(undefined)
            const terminal = Object.create(BaseTerminalTabComponent.prototype)
            ;(appService as any).activeTab = { focusedTab: terminal }

            service.toggleTmuxMode()

            expect(attachSpy).toHaveBeenCalledWith(terminal)
        })

        it('does not re-attach a terminal tab already in a session', async () => {
            const { service } = createService()
            const context = createContext()
            ;(service as any).sessions.add(context)
            const unshiftSpy = vi.spyOn(context.terminalTab.session.middleware, 'unshift')

            await service.attachToTerminal(context.terminalTab)

            expect(unshiftSpy).not.toHaveBeenCalled()
        })

        it.each([false, true])(
            'ignores non-terminal active tabs (connected: %s)',
            async (connected) => {
                const { service, appService } = createService()
                const attachSpy = vi.spyOn(service, 'attachToTerminal').mockResolvedValue(undefined)
                const context = createContext()
                if (connected) {
                    ;(service as any).sessions.add(context)
                }
                ;(appService as any).activeTab = {} as any

                await service.toggleTmuxMode()

                expect(attachSpy).not.toHaveBeenCalled()
                expect(context.controller.gateway.detach).not.toHaveBeenCalled()
            },
        )
    })

    describe('toggle hotkey wiring', () => {
        it('responds to the tmuxPlugin.toggle-tmux-mode hotkey', () => {
            const { service, hotkeysService } = createService()
            const toggleSpy = vi
                .spyOn(service, 'toggleTmuxMode')
                .mockImplementation(() => undefined)

            ;(hotkeysService as any).unfilteredHotkey$.next('tmuxPlugin.toggle-tmux-mode')

            expect(toggleSpy).toHaveBeenCalled()
        })

        it('ignores unrelated hotkeys', () => {
            const { service, hotkeysService } = createService()
            const toggleSpy = vi
                .spyOn(service, 'toggleTmuxMode')
                .mockImplementation(() => undefined)

            ;(hotkeysService as any).unfilteredHotkey$.next('tmuxPlugin.next-window')

            expect(toggleSpy).not.toHaveBeenCalled()
        })
    })
})

describe('TmuxOutputInterceptor', () => {
    it('handles a server-initiated exit and subsequent shell output in the same packet', async () => {
        const interceptor = new TmuxOutputInterceptor()
        const terminal: string[] = []
        const protocol: string[] = []
        interceptor.outputToTerminal$.subscribe((data) => terminal.push(data.toString()))
        interceptor.rawOutput$.subscribe((data) => protocol.push(data.toString()))
        interceptor.feedFromSession(Buffer.from('\x1bP1000p%exit\r\n\x1b\\shell$ '))
        await interceptor.controlModeEnded
        interceptor.feedFromSession(Buffer.from('echo hello'))
        expect(protocol.join('')).toBe('\x1bP1000p%exit\r\n')
        expect(terminal.join('')).toBe('shell$ echo hello')
    })

    it('does not confuse escaped pane output with the DCS terminator', () => {
        const interceptor = new TmuxOutputInterceptor()
        const terminal: Buffer[] = []
        interceptor.outputToTerminal$.subscribe((data) => terminal.push(data))
        interceptor.feedFromSession(Buffer.from('\x1bP1000p%output %1 \\033\\134\n'))
        expect(terminal).toEqual([])
        interceptor.close()
    })

    it('ignores shell OSC terminators before a fragmented control-mode header', async () => {
        const interceptor = new TmuxOutputInterceptor()
        const terminal: Buffer[] = []
        interceptor.outputToTerminal$.subscribe((data) => terminal.push(data))
        interceptor.feedFromSession(Buffer.from('\x1b]0;shell title\x1b\\\r\n'))
        interceptor.feedFromSession(Buffer.from('\x1bP10'))
        interceptor.feedFromSession(Buffer.from('00p%exit\r\n\x1b\\shell$ '))
        await interceptor.controlModeEnded
        expect(Buffer.concat(terminal).toString()).toBe('shell$ ')
    })

    it('releases disconnect cleanup if the underlying session closes before %exit', async () => {
        const interceptor = new TmuxOutputInterceptor()
        interceptor.close()
        await expect(interceptor.controlModeEnded).resolves.toBeUndefined()
    })
})
