/** Tabby exposes provider classes, but no stable menu/action IDs. */
export const TMUX_MENU_PROVIDER = Symbol('tmux-menu-provider')

// Built-in actions do not belong in tmux panes or the user exclusion list.
export const HIDDEN_BUILTIN_MENU_PROVIDERS = [
    'tab:CopyPasteContextMenu',
    'tab:CommonOptionsContextMenu',
    'tab:TabManagementContextMenu',
    'tab:MiscContextMenu',
    'tab:ProfilesContextMenu',
    'tab:SaveAsProfileContextMenu',
    'tab:TaskCompletionContextMenu',
    'tab:ReconnectContextMenu',
    'tab:SFTPContextMenu',
    'tab:NewTabContextMenu',
]

export function getExcludedMenuProviders(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
        return []
    }
    return [...new Set(value as string[])]
}
