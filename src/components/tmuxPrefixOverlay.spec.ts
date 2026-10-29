import { Subject } from 'rxjs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { TmuxI18nService } from '../services/tmuxI18n.service'

vi.mock('tabby-core', () => ({ ConfigService: class {}, LocaleService: class {} }))

let Overlay: typeof import('./tmuxPrefixOverlay.component').TmuxPrefixOverlayComponent

beforeAll(async () => {
    Overlay = (await import('./tmuxPrefixOverlay.component')).TmuxPrefixOverlayComponent
})

function createOverlay(prefixKey = 'Ctrl-B') {
    const languageChange$ = new Subject<string>()
    const i18n = {
        languageChange$,
        t: (key: string, params: Record<string, string | number> = {}) =>
            Object.keys(params).length ? `${key}(${Object.values(params).join(',')})` : key,
    } as unknown as TmuxI18nService
    const component = new Overlay(i18n)
    component.prefixKey = prefixKey
    component.ngOnChanges()
    return { component, languageChange$ }
}

describe('TmuxPrefixOverlayComponent', () => {
    it('lists the three groups with translated labels', () => {
        const { component } = createOverlay()
        expect(component.groups.map((group) => group.label)).toEqual([
            'prefix.group.windows',
            'prefix.group.panes',
            'prefix.group.session',
        ])
        // Every row label receives the prefix param (only sendPrefix uses it).
        expect(component.groups[0].rows[0]).toEqual({
            keys: 'c',
            label: 'prefix.newWindow(Ctrl-B)',
        })
        expect(component.hint).toBe('prefix.escHint')
    })

    it('shows the configured prefix in the title and the send-prefix row', () => {
        const { component } = createOverlay('Ctrl-A')
        expect(component.title).toBe('prefix.title(Ctrl-A)')
        const session = component.groups[2]
        expect(session.rows).toContainEqual({ keys: 'Ctrl-A', label: 'prefix.sendPrefix(Ctrl-A)' })
    })

    it('rebuilds when the prefix input or the language changes', () => {
        const { component, languageChange$ } = createOverlay()
        component.prefixKey = 'Alt-X'
        component.ngOnChanges()
        expect(component.title).toBe('prefix.title(Alt-X)')

        const before = component.groups
        languageChange$.next('zh')
        expect(component.groups).not.toBe(before)
        expect(component.groups[2].rows[1].keys).toBe('Alt-X')
        component.ngOnDestroy()
    })

    it('reports a backdrop click as dismissal and blocks its default', () => {
        const { component } = createOverlay()
        const dismissed = vi.fn()
        component.dismiss.subscribe(dismissed)
        const event = { preventDefault: vi.fn() } as unknown as MouseEvent
        component.onBackdropMouseDown(event)
        expect(event.preventDefault).toHaveBeenCalled()
        expect(dismissed).toHaveBeenCalledTimes(1)
    })
})
