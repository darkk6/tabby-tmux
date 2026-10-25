import { describe, expect, it } from 'vitest'
import { findMenuProviderIdentity, formatMenuSourceName, getMenuProviderLabels } from './tmuxMenu'

describe('menu provider metadata', () => {
    it('loads persisted menu titles while ignoring malformed cache entries', () => {
        expect([
            ...getMenuProviderLabels([
                { id: 'terminal:electron:0', label: 'Export to file' },
                { id: 'tab:tools:0', label: 'Custom actions' },
                null,
                {},
                { id: 1, label: 'Invalid' },
                { id: 'tab:bad:0', label: ' ' },
            ]),
        ]).toEqual([
            ['terminal:electron:0', 'Export to file'],
            ['tab:tools:0', 'Custom actions'],
        ])
        expect(getMenuProviderLabels(undefined).size).toBe(0)
    })

    it('matches constructors by reference and counts registrations for the selected API only', () => {
        const first = new (class l {})()
        const second = new (class l {})()
        const token = {}
        const otherToken = {}
        const module = {
            pluginName: 'tools',
            ɵinj: {
                providers: [
                    { provide: otherToken, useClass: first.constructor },
                    [
                        { provide: token, useClass: first.constructor },
                        { provide: token, useClass: second.constructor },
                    ],
                ],
            },
        }
        expect(findMenuProviderIdentity(first, token, [module])).toEqual({
            pluginName: 'tools',
            slot: 0,
        })
        expect(findMenuProviderIdentity(second, token, [module])).toEqual({
            pluginName: 'tools',
            slot: 1,
        })
        expect(findMenuProviderIdentity({}, token, [module])).toBeUndefined()
    })

    it('supports ModuleWithProviders metadata, aliases and value providers', () => {
        const alias = new (class Alias {})()
        const value = {}
        const token = {}
        const entry = {
            pluginName: 'wrapped',
            ngModule: { ɵinj: { providers: [{ provide: token, useExisting: alias.constructor }] } },
            providers: [[{ provide: token, useValue: value }]],
        }
        expect(findMenuProviderIdentity(alias, token, [entry])).toEqual({
            pluginName: 'wrapped',
            slot: 0,
        })
        expect(findMenuProviderIdentity(value, token, [entry])).toEqual({
            pluginName: 'wrapped',
            slot: 1,
        })
    })

    it('uses the module name when a wrapper has no name and skips unnamed modules', () => {
        const provider = new (class Provider {})()
        const token = {}
        const metadata = {
            ɵinj: { providers: [{ provide: token, useClass: provider.constructor }] },
        }
        expect(findMenuProviderIdentity(provider, token, [metadata])).toBeUndefined()
        expect(
            findMenuProviderIdentity(provider, token, [
                { ngModule: { ...metadata, pluginName: 'named' } },
            ]),
        ).toEqual({ pluginName: 'named', slot: 0 })
    })

    it.each([
        ['push-toolkit', 'Push Toolkit'],
        ['tabby-push-toolkit', 'Push Toolkit'],
        ['terminus-file_tools', 'File Tools'],
        ['LegacyUploadProvider', 'Legacy Upload'],
    ])('formats %s as a readable source name', (name, expected) => {
        expect(formatMenuSourceName(name)).toBe(expected)
    })
})
