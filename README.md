# tabby-tmux

[中文](README.zh-CN.md)

[![Build](https://github.com/ruanimal/tabby-tmux/actions/workflows/build.yml/badge.svg)](https://github.com/ruanimal/tabby-tmux/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/tabby-tmux)](https://www.npmjs.com/package/tabby-tmux)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A [Tabby](https://tabby.sh/) plugin that provides tmux Control Mode integration, inspired by [iTerm2 tmux Integration](https://iterm2.com/documentation-tmux-integration.html).

## Features

- **Native UI integration** — Maps tmux windows and panes into native Tabby components
- **Session persistence** — tmux sessions survive Tabby restarts; reconnect via `tmux -CC attach`
- **Window bar** — Collapsible bottom bar for switching tmux windows, with support for creating new windows and disconnecting
- **Layout sync** — Automatically syncs tmux layout into Tabby SplitTab

![tmux-pane](./doc/img/pane.png)

## Requirements

**tmux 3.1 or later** must be installed on the machine where the terminal session runs. For SSH connections, this means the remote host. The plugin uses `capture-pane -N`, which was added in tmux 3.1; older versions such as 3.0a can display `capture-pane` usage errors when opening panes.

Check the installed version with:

```bash
tmux -V
```

### Linux: upgrading with a static binary

If your distribution's package repository provides an older tmux, you can use a prebuilt Linux static binary from the third-party [build-static-tmux Releases](https://github.com/mjakob-gh/build-static-tmux/releases) instead of compiling tmux and its dependencies yourself.

Choose a recent stable version matching your machine's architecture (`uname -m`), download and extract it if needed, then install the binary as `tmux` in a directory on your `PATH`. For example, replace `/path/to/downloaded/tmux` below with the downloaded binary's actual path:

```bash
mkdir -p "$HOME/.local/bin"
install -m 755 /path/to/downloaded/tmux "$HOME/.local/bin/tmux"
export PATH="$HOME/.local/bin:$PATH"
command -v tmux
tmux -V
```

Add the `export PATH=...` line to your shell's startup file so new terminal sessions also use the upgraded binary.

Upgrading the executable does not upgrade an already-running tmux server. Check the version of the server you are connecting to with:

```bash
tmux display-message -p '#{version}'
```

If the server is still older than 3.1, save your work and finish the tasks in its sessions before restarting it with the new binary, then re-enter tmux mode.

## Installation

### Via Tabby Settings

1. Open Tabby → **Settings** → **Plugins**
2. Search for `tabby-tmux`
3. Click **Install**

### Via command line

```bash
cd <tabby-plugins-dir>
npm install tabby-tmux
```

## Usage

1. Open any terminal tab in Tabby
2. Right-click the tab → **Enter Tmux Mode**
3. The bottom window bar appears — switch between tmux windows and panes from there
4. Right-click → **Exit Tmux Mode** to detach

## Configuration

### History restoration limit

Set **Settings → Tmux → History rows to restore** to limit each pane to its most recent history rows (default: **5000**). The limit counts tmux physical rows and excludes the current screen. Set it to **0** to restore only the current screens. Changes apply to the next restoration or attach and do not delete history from tmux.

The actual number restored also depends on how much history tmux still holds and Tabby's terminal scrollback capacity. tmux defaults to a `history-limit` of **2000**, so a plugin limit of 5000 may restore only about 2000 rows. The plugin does not change this tmux setting and cannot recover history that tmux has already discarded.

To retain more history, add the following to `~/.tmux.conf` on the machine running tmux (the remote host for SSH sessions), then load it with `tmux source-file ~/.tmux.conf`:

```tmux
set -g history-limit 50000
```

In tmux 3.4, changing `history-limit` applies only to newly created panes; existing panes keep their original capacity even after reattaching. Create a new window or pane after loading the configuration to use the larger capacity. Also ensure Tabby's terminal scrollback capacity is at least the desired restoration limit.

Check each pane's currently retained history and actual capacity with:

```sh
tmux list-panes -a -F '#{pane_id} history_size=#{history_size} history_limit=#{history_limit}'
```

### Right-click behavior

With **Settings → Terminal → "On right-click"** set to `Menu`, right-clicking inside a tmux pane opens its context menu, including tmux actions and menus contributed by other plugins.

Built-in copy/paste, pane rename/label, close/split, toolbar/focus, switch-profile, save-as-profile, task/activity notifications, disconnect/reconnect, SFTP, and new-terminal/profile menus are automatically hidden in tmux panes and omitted from the settings list. Tmux's own actions remain available.

Use **Settings → Tmux → Excluded pane menus** to exclude other menu groups by source. Checked groups are skipped before their menus are requested. Resetting exclusions re-enables these other groups while keeping the built-in menus hidden.

Other plugin menus are enabled by default, but displaying a menu does not guarantee that its actions work with tmux. Exclusions apply the next time you open a pane menu; normal terminal and tab-header menus are unaffected. Legacy terminal-menu plugins are listed separately too. Sources are identified by provider class name (with separate IDs for the two menu APIs), so a plugin that renames its provider may need its exclusion selected again.

If you set **"On right-click"** to `Paste` or `Clipboard` in Tabby settings, this plugin will respect that choice:

- **Quick right-click** → performs the configured action (paste from clipboard / copy selection)
- **Long press (≥ 250 ms)** → still opens the tmux pane context menu, so all tmux features remain accessible

> **Tip:** If the tmux menu feels hard to reach after changing the setting, hold the right mouse button down for a moment before releasing.

## Keyboard shortcuts

In tmux mode, shortcuts are layered (see `doc/DESIGN_KEYBINDINGS.md`):

- **Pane operations reuse Tabby's native shortcuts** — they act on the tmux pane directly (the plugin translates them into tmux commands):
    - Split: `Ctrl+Shift+S` (right) / `Ctrl+Shift+D` (down)
    - Pane navigation: `Ctrl+Alt+Arrow`
    - **Zoom pane** (maximize): `Ctrl+Alt+Enter` — press again to unzoom (`⌘+⌥+Enter` on macOS)
- **Window operations are tmux-mode-specific shortcuts** (defaults below; rebind in Tabby Settings → Hotkeys):
    - Previous / next window: `Ctrl+Shift+[` / `Ctrl+Shift+]`
    - Go to window 1–9: `Ctrl+Shift+1..9`
    - New window: `Ctrl+Shift+B`
    - Toggle tmux mode: `Ctrl+Shift+X` — exits tmux mode when connected; enters it from the active terminal tab when idle
- **Tabby top-level shortcuts** (switch/close tabs, etc.) are unchanged

All shortcuts — including the plugin-specific ones — are configured in **Tabby Settings → Hotkeys**; the plugin settings page intentionally has no shortcut form, to avoid a second conflicting entry point.

## Compatibility

### trzsz

This plugin is fully compatible with the [tabby-trzsz](https://github.com/trzsz/tabby-trzsz) plugin, enabling file transfer (`trz`/`tsz`) and drag-and-drop upload over tmux panes.

Install both plugins and they work together automatically:

```bash
cd <tabby-plugins-dir>
npm install tabby-tmux tabby-trzsz
```

> **Note:** When uploading files over WebSocket terminals (e.g. via [tabby-ws-term](https://github.com/ruanimal/tabby-ws-term)), use `trzsz -B 10K` to improve compatibility.

## Development

```bash
pnpm install
pnpm run watch  # watch mode

# Launch Tabby with the plugin loaded
TABBY_PLUGINS=$(pwd) tabby --debug
```

Run the restoration performance benchmarks (requires local tmux ≥ 3.1 and Vim):

```bash
pnpm run test:performance
```

The benchmarks check transfer volume, restoration time, and screen correctness with large histories, multiple windows, continuous output, and Vim. See the [performance analysis](doc/FIX_ATTACH_PERFORMANCE.md) for reproduction steps, budgets, and measurements.

## License

MIT
