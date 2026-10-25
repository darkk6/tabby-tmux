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
    private labels = new Map<string, string>()
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
    }

    private getSources(): MenuSource[] {
        const sources: MenuSource[] = []
        const providers = this.config.enabledServices(this.providers ?? [])
        for (const provider of providers) {
            // Expand the enabled legacy bridge so each legacy plugin can be
            // excluded independently, without requesting its items twice.
            if (provider.constructor.name === 'LegacyContextMenu') {
                for (const legacy of this.config.enabledServices(this.legacyProviders ?? [])) {
                    sources.push({
                        id: `terminal:${legacy.constructor.name}`,
                        weight: provider.weight,
                        tmux: false,
                        getItems: (tab) => legacy.getItems(tab),
                    })
                }
            } else {
                sources.push({
                    id: `tab:${provider.constructor.name}`,
                    weight: provider.weight,
                    tmux: !!provider[TMUX_MENU_PROVIDER],
                    getItems: (tab) => provider.getItems(tab),
                })
            }
        }
        return sources
            .filter((source) => !HIDDEN_BUILTINS.has(source.id))
            .sort((a, b) => a.weight - b.weight)
    }

    getGroups(): TmuxMenuGroup[] {
        const sources = this.getSources()
        const protectedIds = new Set(
            sources.filter((source) => source.tmux).map((source) => source.id),
        )
        const ids = new Set(sources.filter((source) => !source.tmux).map((source) => source.id))
        // Keep saved exclusions editable even after a plugin is uninstalled.
        for (const id of getExcludedMenuProviders(
            this.config.store.tmuxPlugin.excludedMenuProviders,
        )) {
            if (!protectedIds.has(id) && !HIDDEN_BUILTINS.has(id)) ids.add(id)
        }
        return [...ids].map((id) => ({
            id,
            label:
                this.labels.get(id) ??
                id
                    .substring(id.indexOf(':') + 1)
                    .replace(
                        /(ContextMenuItemProvider|ContextMenuProvider|ContextMenu|Provider)$/,
                        '',
                    )
                    .replace(/([a-z])([A-Z])/g, '$1 $2'),
        }))
    }

    async buildMenu(
        tab: BaseTerminalTabComponent<BaseTerminalProfile>,
    ): Promise<MenuItemOptions[]> {
        const excluded = new Set(
            getExcludedMenuProviders(this.config.store.tmuxPlugin.excludedMenuProviders),
        )
        const sections = await Promise.all(
            this.getSources()
                .filter((source) => source.tmux || !excluded.has(source.id))
                .map(async (source) => {
                    try {
                        const items = cleanSeparators(await source.getItems(tab))
                        const labels = items.map((item) => item.label).filter(Boolean)
                        if (labels.length) this.labels.set(source.id, labels.join(' / '))
                        return items
                    } catch (error) {
                        this.logger.warn(`Context menu provider ${source.id} failed`, error)
                        return []
                    }
                }),
        )
        return cleanSeparators(
            sections.reduce<MenuItemOptions[]>(
                (items, section) => items.concat(section, { type: 'separator' }),
                [],
            ),
        )
    }
}
