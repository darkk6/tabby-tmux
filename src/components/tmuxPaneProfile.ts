import type { TerminalColorScheme } from 'tabby-terminal'

/** Subset of the host terminal tab's profile that tmux panes inherit. */
export interface HostProfile {
    terminalColorScheme?: TerminalColorScheme | null
}

/** Builds the synthetic profile for a tmux pane tab, inheriting the host's color scheme. */
export function buildPaneProfile(
    name: string,
    hostProfile: HostProfile | null,
): Record<string, unknown> {
    return {
        name,
        type: 'tmux',
        options: {},
        // Required properties for BaseTerminalTabComponent
        behaviorOnSessionEnd: 'close',
        terminalColorScheme: hostProfile?.terminalColorScheme ?? null,
    }
}
