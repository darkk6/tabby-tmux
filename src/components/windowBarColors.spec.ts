import { describe, expect, it } from 'vitest'
import { buildWindowBarColorVars } from './windowBarColors'

const scheme = {
    name: 'Test',
    foreground: '#eeeeee',
    background: '#111111',
    cursor: '#ffffff',
    colors: ['#000000', '#ff0000', '#00ff00'],
}

describe('buildWindowBarColorVars', () => {
    it('returns no variables without a color scheme', () => {
        expect(buildWindowBarColorVars(null)).toEqual({})
        expect(buildWindowBarColorVars(undefined)).toEqual({})
    })

    it('uses the scheme background and foreground for the bar', () => {
        const vars = buildWindowBarColorVars(scheme)

        expect(vars['--bar-bg']).toBe('#111111')
        expect(vars['--bar-fg']).toBe('#eeeeee')
    })

    it('mixes derived colors from foreground and background', () => {
        const vars = buildWindowBarColorVars(scheme)

        expect(vars['--bar-border']).toBe('color-mix(in srgb, #eeeeee 15%, #111111)')
        expect(vars['--bar-hover-bg']).toBe('color-mix(in srgb, #eeeeee 10%, #111111)')
        expect(vars['--bar-active-bg']).toBe('color-mix(in srgb, #eeeeee 18%, #111111)')
        expect(vars['--bar-active-border']).toBe('color-mix(in srgb, #eeeeee 30%, #111111)')
        expect(vars['--bar-fg-dim']).toBe('color-mix(in srgb, #eeeeee 55%, #111111)')
        expect(vars['--bar-fg-more']).toBe('color-mix(in srgb, #eeeeee 80%, #111111)')
    })

    it('uses the ANSI red color for the danger accent', () => {
        expect(buildWindowBarColorVars(scheme)['--bar-danger']).toBe('#ff0000')
    })

    it('falls back to a default danger color when the palette is short', () => {
        expect(buildWindowBarColorVars({ ...scheme, colors: [] })['--bar-danger']).toBe('#f66')
    })
})
