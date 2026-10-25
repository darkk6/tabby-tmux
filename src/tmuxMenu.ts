/** Tabby exposes providers through its loaded Angular module metadata. */
export const TMUX_MENU_PROVIDER = Symbol('tmux-menu-provider')

export interface MenuProviderLabel {
    id: string
    label: string
}

export function getMenuProviderLabels(value: unknown): Map<string, string> {
    if (!Array.isArray(value)) return new Map()
    return new Map(
        value
            .filter(
                (entry): entry is MenuProviderLabel =>
                    !!entry &&
                    typeof entry.id === 'string' &&
                    typeof entry.label === 'string' &&
                    !!entry.label.trim(),
            )
            .map(({ id, label }) => [id, label]),
    )
}

interface ProviderRegistration {
    provide?: unknown
    useClass?: unknown
    useExisting?: unknown
    useValue?: unknown
}

export interface MenuPluginModule {
    pluginName?: string
    ngModule?: MenuPluginModule
    providers?: unknown[]
    ɵinj?: { providers?: unknown[] }
}

export interface MenuProviderIdentity {
    pluginName: string
    slot: number
}

/** Resolve by constructor identity, never by the (possibly minified) name. */
export function findMenuProviderIdentity(
    provider: object,
    token: unknown,
    modules: MenuPluginModule[],
): MenuProviderIdentity | undefined {
    for (const entry of modules) {
        const module = entry.ngModule ?? entry
        const pluginName = entry.pluginName ?? module.pluginName
        if (!pluginName) continue
        let slot = 0
        const visit = (registrations: unknown[]): MenuProviderIdentity | undefined => {
            for (const registration of registrations) {
                if (Array.isArray(registration)) {
                    const found = visit(registration)
                    if (found) return found
                    continue
                }
                const item = registration as ProviderRegistration | null
                if (!item || item.provide !== token) continue
                const currentSlot = slot++
                if (
                    (item.useClass ?? item.useExisting) === provider.constructor ||
                    item.useValue === provider
                ) {
                    return { pluginName, slot: currentSlot }
                }
            }
            return undefined
        }
        const found = visit([module.ɵinj?.providers ?? [], entry.providers ?? []])
        if (found) return found
    }
    return undefined
}

export function formatMenuSourceName(name: string): string {
    return name
        .replace(/^(tabby-|terminus-)/, '')
        .replace(/(ContextMenuItemProvider|ContextMenuProvider|ContextMenu|Provider)$/, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

// Built-in actions do not belong in tmux panes or the user exclusion list.
export const HIDDEN_BUILTIN_MENU_PROVIDERS = [
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
]

export function getExcludedMenuProviders(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
        return []
    }
    return [...new Set(value as string[])]
}
