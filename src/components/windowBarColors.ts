import type { TerminalColorScheme } from 'tabby-terminal'

/**
 * Maps a terminal color scheme onto the CSS custom properties used by the
 * window bar. Returns an empty object when there is no scheme, so the bar
 * keeps falling back to the application theme variables.
 */
export function buildWindowBarColorVars(
    scheme: TerminalColorScheme | null | undefined,
): Record<string, string> {
    if (!scheme) return {}
    const { background: bg, foreground: fg } = scheme
    const mix = (percent: number): string => `color-mix(in srgb, ${fg} ${percent}%, ${bg})`
    return {
        '--bar-bg': bg,
        '--bar-border': mix(15),
        '--bar-fg': fg,
        '--bar-fg-more': mix(80),
        '--bar-fg-dim': mix(55),
        '--bar-hover-bg': mix(10),
        '--bar-active-bg': mix(18),
        '--bar-active-border': mix(30),
        '--bar-danger': scheme.colors?.[1] ?? '#f66',
    }
}
