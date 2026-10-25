import { Inject, Injectable, Optional } from '@angular/core'
import {
    ConfigService,
    LogService,
    Logger,
    MenuItemOptions,
    TabContextMenuItemProvider,
} from 'tabby-core'
import {
    BaseTerminalProfile,
    BaseTerminalTabComponent,
    TerminalContextMenuItemProvider,
} from 'tabby-terminal'
import {
    getExcludedMenuProviders,
    getMenuProviderLabels,
    findMenuProviderIdentity,
    formatMenuSourceName,
    MenuPluginModule,
    HIDDEN_BUILTIN_MENU_PROVIDERS,
    TMUX_MENU_PROVIDER,
} from '../tmuxMenu'

const HIDDEN_BUILTINS = new Set(HIDDEN_BUILTIN_MENU_PROVIDERS)

export interface TmuxMenuGroup {
    id: string
    label: string
}

interface MenuSource {
    id: string
    label: string
    weight: number
    tmux: boolean
    getItems(tab: BaseTerminalTabComponent<BaseTerminalProfile>): Promise<MenuItemOptions[]>
}

function cleanSeparators(items: MenuItemOptions[]): MenuItemOptions[] {
    const result: MenuItemOptions[] = []
    for (const item of items) {
        if (
            item.type !== 'separator' ||
            (result.length && result[result.length - 1].type !== 'separator')
        ) {
            result.push(item)
        }
    }
    if (result[result.length - 1]?.type === 'separator') result.pop()
    return result
}

/** Composes pane menus without changing Tabby's global provider registrations. */
@Injectable({ providedIn: 'root' })
export class TmuxMenuService {
    private labels: Map<string, string>
    private logger: Logger

    constructor(
        private config: ConfigService,
        log: LogService,
        @Optional()
        @Inject(TabContextMenuItemProvider)
        private providers: TabContextMenuItemProvider[] | null,
        @Optional()
        @Inject(TerminalContextMenuItemProvider)
        private legacyProviders: TerminalContextMenuItemProvider[] | null,
    ) {
        this.logger = log.create('tmux-menu')
        this.labels = getMenuProviderLabels(this.config.store.tmuxPlugin.menuProviderLabels)
    }

    private getSources(): MenuSource[] {
        const modules: MenuPluginModule[] =
            typeof window === 'undefined' ? [] : (window['pluginModules'] ?? [])
        const sources: MenuSource[] = []
        const identify = (
            provider: TabContextMenuItemProvider | TerminalContextMenuItemProvider,
            api: 'tab' | 'terminal',
            index: number,
        ) => {
            const token =
                api === 'tab' ? TabContextMenuItemProvider : TerminalContextMenuItemProvider
            const identity = findMenuProviderIdentity(provider, token, modules)
            // Unknown sources still need distinct IDs when metadata is absent.
            const pluginName = identity?.pluginName ?? 'unregistered'
            const slot = identity?.slot ?? index
            const id = `${api}:${encodeURIComponent(pluginName)}:${slot}`
            const label =
                formatMenuSourceName(identity?.pluginName ?? provider.constructor.name) ||
                `Menu ${slot + 1}`
            return { id, label, pluginName }
        }
        const providers = this.config.enabledServices(this.providers ?? [])
        for (const provider of providers) {
            const source = identify(provider, 'tab', (this.providers ?? []).indexOf(provider))
            // Built-in behavior is identified by both the owner and class, so
            // an unrelated plugin using the same class name remains available.
            const builtin =
                source.pluginName === 'unregistered' ||
                ['core', 'terminal', 'local', 'ssh'].includes(source.pluginName)
            if (builtin && provider.constructor.name === 'LegacyContextMenu') {
                for (const legacy of this.config.enabledServices(this.legacyProviders ?? [])) {
                    sources.push({
                        ...identify(
                            legacy,
                            'terminal',
                            (this.legacyProviders ?? []).indexOf(legacy),
                        ),
                        weight: provider.weight,
                        tmux: false,
                        getItems: (tab) => legacy.getItems(tab),
                    })
                }
            } else if (!builtin || !HIDDEN_BUILTINS.has(provider.constructor.name)) {
                sources.push({
                    ...source,
                    weight: provider.weight,
                    tmux: !!provider[TMUX_MENU_PROVIDER],
                    getItems: (tab) => provider.getItems(tab),
                })
            }
        }
        return sources.sort((a, b) => a.weight - b.weight)
    }

    getGroups(): TmuxMenuGroup[] {
        const sources = this.getSources()
        const protectedIds = new Set(
            sources.filter((source) => source.tmux).map((source) => source.id),
        )
        const groups = new Map(
            sources.filter((source) => !source.tmux).map((source) => [source.id, source]),
        )
        // Keep saved exclusions editable even after a plugin is uninstalled.
        const ids = new Set([
            ...groups.keys(),
            ...getExcludedMenuProviders(this.config.store.tmuxPlugin.excludedMenuProviders),
        ])
        return [...ids]
            .filter((id) => !protectedIds.has(id))
            .map((id) => ({
                id,
                label: this.labels.get(id) ?? groups.get(id)?.label ?? this.getSavedLabel(id),
            }))
    }

    private getSavedLabel(id: string): string {
        const parts = id.split(':')
        let name = parts[1] ?? id
        try {
            name = decodeURIComponent(name)
        } catch {
            // Keep malformed or manually edited IDs readable and removable.
        }
        return formatMenuSourceName(name)
    }

    async buildMenu(
        tab: BaseTerminalTabComponent<BaseTerminalProfile>,
    ): Promise<MenuItemOptions[]> {
        const sources = this.getSources()
        const excluded = new Set(
            getExcludedMenuProviders(this.config.store.tmuxPlugin.excludedMenuProviders),
        )
        let labelsChanged = false
        const sections = await Promise.all(
            sources
                .filter((source) => source.tmux || !excluded.has(source.id))
                .map(async (source) => {
                    try {
                        const items = cleanSeparators(await source.getItems(tab))
                        const labels = items.map((item) => item.label).filter(Boolean)
                        const label = labels.join(' / ')
                        if (!source.tmux && label && this.labels.get(source.id) !== label) {
                            this.labels.set(source.id, label)
                            labelsChanged = true
                        }
                        return items
                    } catch (error) {
                        this.logger.warn(`Context menu provider ${source.id} failed`, error)
                        return []
                    }
                }),
        )
        if (labelsChanged) {
            this.config.store.tmuxPlugin.menuProviderLabels = [...this.labels].map(
                ([id, label]) => ({ id, label }),
            )
            void this.config.save().catch((error) => {
                this.logger.warn('Failed to save menu titles', error)
            })
        }
        return cleanSeparators(
            sections.reduce<MenuItemOptions[]>(
                (items, section) => items.concat(section, { type: 'separator' }),
                [],
            ),
        )
    }
}
