import { describe, expect, it } from 'vitest'
import { buildPaneProfile } from './tmuxPaneProfile'

describe('buildPaneProfile', () => {
    it('inherits the host terminal color scheme', () => {
        const scheme = {
            name: 'Solarized Dark',
            foreground: '#fff',
            background: '#000',
            cursor: '#fff',
            colors: [],
        }

        const profile = buildPaneProfile('pane', { terminalColorScheme: scheme })

        expect(profile).toMatchObject({
            name: 'pane',
            type: 'tmux',
            terminalColorScheme: scheme,
        })
    })

    it('falls back to the default scheme when there is no host profile', () => {
        expect(buildPaneProfile('pane', null).terminalColorScheme).toBeNull()
    })

    it('falls back to the default scheme when the host has none', () => {
        expect(
            buildPaneProfile('pane', { terminalColorScheme: null }).terminalColorScheme,
        ).toBeNull()
        expect(buildPaneProfile('pane', {}).terminalColorScheme).toBeNull()
    })
})
