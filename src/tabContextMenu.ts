import { Injectable } from '@angular/core'
import { TabContextMenuItemProvider, MenuItemOptions, BaseTabComponent } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { TmuxService } from './services/tmux.service'
import { TmuxI18nService } from './services/tmuxI18n.service'
import { TmuxSessionTabComponent } from './components/tmuxSessionTab.component'
import { TmuxPaneTabComponent } from './components/tmuxPaneTab.component'
import { TMUX_MENU_PROVIDER } from './tmuxMenu'

/**
 * TmuxContextMenuProvider - Adds tmux-related items to tab context menu.
 *
 * - On a terminal tab: "Enter Tmux Mode"
 * - On a TmuxSessionTab: "Exit Tmux Mode"
 * - On a TmuxPaneTab: the shared tmux pane menu
 */
@Injectable()
export class TmuxContextMenuProvider extends TabContextMenuItemProvider {
    weight = 5
    readonly [TMUX_MENU_PROVIDER] = true

    constructor(
        private tmuxService: TmuxService,
        private i18n: TmuxI18nService,
    ) {
        super()
    }

    async getItems(tab: BaseTabComponent, tabHeader?: boolean): Promise<MenuItemOptions[]> {
        // On a TmuxSessionTab: show exit option
        if (tab instanceof TmuxSessionTabComponent) {
            return [
                {
                    label: this.i18n.t('mode.exit'),
                    click: async () => {
                        await this.tmuxService.disconnect()
                    },
                },
            ]
        }

        if (tab instanceof TmuxPaneTabComponent) {
            return tab.buildTmuxContextMenu(tabHeader)
        }

        // On a terminal tab: show enter tmux mode option
        if (tab instanceof BaseTerminalTabComponent) {
            return [
                {
                    label: this.i18n.t('mode.enter'),
                    click: async () => {
                        await this.tmuxService.attachToTerminal(
                            tab as BaseTerminalTabComponent<any>,
                        )
                    },
                },
            ]
        }

        return []
    }
}
