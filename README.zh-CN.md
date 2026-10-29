# tabby-tmux

[English](README.md)

[![Build](https://github.com/ruanimal/tabby-tmux/actions/workflows/build.yml/badge.svg)](https://github.com/ruanimal/tabby-tmux/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/tabby-tmux)](https://www.npmjs.com/package/tabby-tmux)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Tabby](https://tabby.sh/) 终端模拟器的 tmux Control Mode 集成插件，灵感来自 [iTerm2 tmux Integration](https://iterm2.com/documentation-tmux-integration.html)。

## 功能

- **原生 UI 集成** — 将 tmux window 和 pane 映射为 Tabby 原生组件
- **会话持久化** — Tabby 关闭后 tmux 会话保持运行，重新打开时通过 `tmux -CC attach` 恢复
- **底部窗口栏** — 可折叠的 tmux window 切换栏，支持新建 window、断开连接
- **布局同步** — 自动同步 tmux layout 到 Tabby SplitTab

![tmux-pane](./doc/img/pane.png)

## 环境要求

终端 session 所在的机器需要安装 **tmux 3.1 或更新版本**。通过 SSH 连接时，需要升级的是远程主机上的 tmux。本插件使用了 tmux 3.1 才加入的 `capture-pane -N` 参数；3.0a 等旧版本可能在打开 pane 时显示 `capture-pane` usage 错误。

可通过以下命令检查已安装的版本：

```bash
tmux -V
```

### Linux：使用静态二进制升级

如果系统软件源提供的 tmux 版本较旧，可以使用第三方项目 [build-static-tmux Releases](https://github.com/mjakob-gh/build-static-tmux/releases) 提供的 Linux 预编译静态二进制，无需自行编译 tmux 及其依赖。

选择与机器架构（通过 `uname -m` 查看）匹配的较新稳定版本，下载并按需解压，将二进制以 `tmux` 为名安装到 `PATH` 中的目录。例如，将下面的 `/path/to/downloaded/tmux` 替换为下载所得二进制的实际路径：

```bash
mkdir -p "$HOME/.local/bin"
install -m 755 /path/to/downloaded/tmux "$HOME/.local/bin/tmux"
export PATH="$HOME/.local/bin:$PATH"
command -v tmux
tmux -V
```

将 `export PATH=...` 这一行加入所用 shell 的启动配置文件，确保新开的终端 session 也使用升级后的二进制。

升级可执行文件不会升级已经运行的 tmux server。可通过以下命令检查所连接的 server 版本：

```bash
tmux display-message -p '#{version}'
```

如果 server 仍低于 3.1，请先保存工作并结束其中 session 内的任务，再使用新版本二进制重启 server，之后重新进入 tmux 模式。

## 安装

### 通过 Tabby 设置界面

1. 打开 Tabby → **Settings** → **Plugins**
2. 搜索 `tabby-tmux`
3. 点击 **Install**

### 通过命令行

```bash
cd <tabby-plugins-dir>
npm install tabby-tmux
```

## 使用

1. 在 Tabby 中打开任意终端标签页
2. 右键点击标签页 → **Enter Tmux Mode**
3. 底部出现 tmux window 栏，可切换 window 和 pane
4. 右键 → **Exit Tmux Mode** 退出 tmux 模式

## 配置

### 恢复历史行数

在 **Settings → Tmux → 恢复历史行数** 中设置每个 pane 恢复的最近历史行数，默认 **5000**。按 tmux 的物理行计数，不包含当前屏幕；设为 **0** 时仅恢复当前屏幕。修改后在下次恢复或重新 attach 时生效，不删除 tmux 中的历史。

实际恢复行数还受 tmux 已保存的历史行数和 Tabby 终端的回滚容量限制。tmux 的 `history-limit` 默认是 **2000**，因此即使插件设置为 5000，也可能只能恢复约 2000 行。插件不会修改这个 tmux 设置，也无法恢复 tmux 已丢弃的历史。

如需保留更多历史，在运行 tmux 的机器上（SSH 场景为远端主机）的 `~/.tmux.conf` 中加入以下配置，再执行 `tmux source-file ~/.tmux.conf` 加载：

```tmux
set -g history-limit 50000
```

在 tmux 3.4 中，修改 `history-limit` 仅对新创建的 pane 生效；已有 pane 会保留原来的容量，重新 attach 也不会扩大容量。加载配置后，需要新建 window 或 pane 才能使用更大的容量。同时，Tabby 终端的回滚容量也应不小于期望恢复的行数。

可用以下命令查看每个 pane 当前保存的历史行数及实际容量：

```sh
tmux list-panes -a -F '#{pane_id} history_size=#{history_size} history_limit=#{history_limit}'
```

### 右键行为

当 **Settings → Terminal → "On right-click"** 为 `Menu` 时，在 tmux pane 内右键会显示 pane 菜单，其中包含 tmux 操作和其他插件提供的菜单。

原生复制/粘贴、pane 重命名/标签、关闭/拆分、工具栏/聚焦、切换 profile、保存为 profile、任务和活动通知、断开/重新连接、SFTP、新建终端/profile 等内置菜单，在 tmux pane 中自动隐藏，也不再出现在设置列表中。tmux 自身的操作始终保留。

在 **Settings → Tmux → 排除的 pane 菜单** 中，可以按来源排除其他菜单组。勾选后，插件会在请求该组菜单前跳过它。重置排除项会重新启用这些菜单组，内置菜单仍保持隐藏。

其他插件的菜单默认启用，但菜单能够显示不代表其操作一定兼容 tmux。排除设置在下次打开 pane 菜单时生效，不影响普通终端和 tab 标题栏菜单；旧版终端菜单插件也会单独列出。菜单来源使用插件名、菜单 API 和注册位置作为 ID，避免压缩类名冲突。打开 pane 菜单时，会从 provider 返回结果中读取真实菜单标题并保存；重启后即使已排除该来源，仍可显示已读取的标题。在首次读取标题之前，设置列表使用插件名显示来源。插件升级如果改变了菜单 provider 的注册顺序，可能需要重新勾选排除项。

如果你在 Tabby 设置中将 **"On right-click"** 改为 `Paste` 或 `Clipboard`，本插件会尊重该选择：

- **短按右键** → 执行设置中的操作（粘贴剪贴板内容 / 复制选中内容）
- **长按右键（≥ 250 毫秒）** → 仍会弹出 tmux pane 上下文菜单，所有 tmux 功能依然可用

> **提示：** 修改设置后如果觉得 tmux 菜单不好调出，可以按住右键稍等片刻再松开，即可触发菜单。

## 快捷键

tmux 模式下快捷键按三层设计（详见 `doc/DESIGN_KEYBINDINGS.md`）：

- **pane 操作复用 Tabby 原生快捷键**（直接作用于 tmux pane，由插件转为 tmux 命令）：
    - 分屏：`Ctrl+Shift+S`（右）/ `Ctrl+Shift+D`（下）
    - pane 导航：`Ctrl+Alt+方向键`
    - **zoom pane（最大化/缩放）**：`Ctrl+Alt+Enter`，再次按下退出 zoom（macOS 为 `⌘+⌥+Enter`）
- **window 操作为 tmux 模式独有快捷键**（默认键位，可在 Tabby Settings → Hotkeys 中修改）：
    - 上一个 / 下一个 window：`Ctrl+Shift+[` / `Ctrl+Shift+]`
    - 跳转 window 1–9：`Ctrl+Shift+1..9`
    - 新建 window：`Ctrl+Shift+B`
    - 切换 tmux mode：`Ctrl+Shift+X` — tmux mode 中按下退出（detach），普通终端中按下进入
- **Tabby 顶层快捷键**（切换 tab、关闭 tab 等）保持不变
- **tmux 前缀键**（默认 `Ctrl+B`，在插件设置页修改；仅在 tmux pane 内生效）：按下前缀后会弹出提示列出可用按键，再按 tmux 原生按键：
    - `c` 新建 window · `n` / `p` 下一个 / 上一个 window · `0`–`9` 按 tmux index 跳转 window · `,` 重命名 window · `&` 关闭 window（先确认）
    - `%` 向右拆分 · `"` 向下拆分 · `←↑↓→` 按方向选择 pane · `o` 下一个 pane · `z` 切换缩放 · `x` 关闭 pane（先确认）
    - `d` detach（退出 tmux mode）· 再按一次前缀键会把前缀键本身发送到 pane
    - `Esc` 或任意其他键取消；第二键可以继续按住 Ctrl（`Ctrl+B Ctrl+N`）

所有 Tabby 热键（包括插件独有的 `tmuxPlugin.*`）统一在 **Tabby Settings → Hotkeys** 中配置。前缀键是唯一例外：它不是 Tabby 热键（全局热键会吞掉所有终端里的 `Ctrl+B`），因此放在插件设置页；第二键固定为 tmux 原生键位，不可修改。

## 兼容性

### trzsz

本插件与 [tabby-trzsz](https://github.com/trzsz/tabby-trzsz) 插件完全兼容，可在 tmux pane 中使用文件传输（`trz`/`tsz`）和拖拽上传。

同时安装两个插件即可自动配合工作：

```bash
cd <tabby-plugins-dir>
npm install tabby-tmux tabby-trzsz
```

> **提示：** 通过 WebSocket 终端上传文件时（如使用 [tabby-ws-term](https://github.com/ruanimal/tabby-ws-term)），建议使用 `trzsz -B 10K` 以提高兼容性。

## 开发调试

```bash
pnpm install
pnpm run watch  # 监听模式

# 启动 Tabby 并加载插件
TABBY_PLUGINS=$(pwd) tabby --debug
```

运行恢复性能基准（需要本机安装 tmux ≥ 3.1 和 Vim）：

```bash
pnpm run test:performance
```

基准会检查大历史、多 window、持续输出与 Vim 场景的传输量、恢复耗时和屏幕正确性。复现方法、预算与测量结果见 [恢复性能分析](doc/FIX_ATTACH_PERFORMANCE.md)。

## License

MIT
