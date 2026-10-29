import { describe, expect, it, vi } from 'vitest'
import type { NgZone } from '@angular/core'
import type { ConfigService } from 'tabby-core'
import type { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import type { TmuxI18nService } from './tmuxI18n.service'
import { TmuxSessionNamePromptService } from './tmuxSessionNamePrompt.service'

vi.mock('tabby-core', () => ({ ConfigService: class {} }))
vi.mock('@ng-bootstrap/ng-bootstrap', () => ({ NgbModal: class {} }))
vi.mock('../components/tmuxSessionNameDialog.component', () => ({
    TmuxSessionNameDialogComponent: class {},
}))
vi.mock('./tmuxI18n.service', () => ({ TmuxI18nService: class {} }))

function createPromptService(defaultSessionName = 'default') {
    let resolveResult: (value: unknown) => void = () => undefined
    let rejectResult: (reason?: unknown) => void = () => undefined
    const componentInstance: Record<string, unknown> = {}
    const open = vi.fn(() => ({
        componentInstance,
        result: new Promise((resolve, reject) => {
            resolveResult = resolve
            rejectResult = reject
        }),
    }))
    const zone = { run: vi.fn((fn: () => unknown) => fn()) }
    const service = new TmuxSessionNamePromptService(
        { open } as unknown as NgbModal,
        { store: { tmuxPlugin: { defaultSessionName } } } as unknown as ConfigService,
        { t: (key: string) => key } as unknown as TmuxI18nService,
        zone as unknown as NgZone,
    )
    return {
        service,
        open,
        zone,
        componentInstance,
        close: (value: unknown) => resolveResult(value),
        dismiss: () => rejectResult('dismissed'),
    }
}

describe('TmuxSessionNamePromptService', () => {
    it('opens the dialog inside the zone, prefilled with the configured default', async () => {
        const { service, open, zone, componentInstance, close } = createPromptService('work')

        const pending = service.prompt()

        expect(open).toHaveBeenCalledOnce()
        expect(zone.run).toHaveBeenCalledOnce()
        expect(componentInstance.draft).toBe('work')
        expect(componentInstance.title).toBe('mode.enter')
        expect(componentInstance.label).toBe('sessionName.label')
        close('dev')
        await expect(pending).resolves.toBe('dev')
        expect(service.isOpen).toBe(false)
    })

    it('resolves null when the dialog is dismissed', async () => {
        const { service, dismiss } = createPromptService()

        const pending = service.prompt()
        dismiss()

        await expect(pending).resolves.toBeNull()
        expect(service.isOpen).toBe(false)
    })

    it('ignores a second request while the dialog is open', async () => {
        const { service, open, close } = createPromptService()

        const first = service.prompt()
        expect(service.isOpen).toBe(true)
        await expect(service.prompt()).resolves.toBeNull()
        expect(open).toHaveBeenCalledOnce()

        close('dev')
        await expect(first).resolves.toBe('dev')

        // Once closed, the next request opens a fresh dialog.
        void service.prompt()
        expect(open).toHaveBeenCalledTimes(2)
    })
})
