# Changelog

本文件记录各版本面向用户的重要变更，按版本从新到旧排列。

## [1.5.1] - 2026-10-22

- 修复 tmux 历史快照恢复在大量历史内容下的性能退化。
- 新增历史恢复上限设置，允许调整恢复的历史行数。
- 修正 tmux 设置页面标签列宽，并说明历史恢复的限制。

## [1.5.0] - 2026-10-21

- 修复恢复 pane 屏幕内容和颜色的问题。
- 补充 tmux 版本要求及静态二进制文件的配置说明。

## [1.4.7]

- 修复 tmux mode 下宿主 profile 配色未能正确保留的问题。

## [1.4.6]

- 修复快照捕获后产生的 pane 输出被丢弃的问题。
- 保留响应中的空行，使恢复后的 pane 屏幕与 tmux 一致。

## [1.4.5]

- 修复 window bar 换行问题，使其保持为单行并支持滚动。

## [1.4.4]

- 新增可配置的 tmux session 标题，并支持复制标题配置帮助信息。

## [1.4.3]

- 新增从终端右键菜单重命名 window 的功能。
- 保证 tmux 响应按顺序处理，并修复 tab 关闭时 pane 清理过早的问题。
- 修复重命名对话框的中文翻译。

## [1.4.2]

- 支持同步 tmux session、window 和 pane 的重命名。
- 在 window 悬停提示中显示 pane 详情。

## [1.4.1]

- 新增退出 tmux mode 的右键菜单项和中文界面翻译。
- 恢复 tmux session 时正确还原 zoom 状态。

## [1.4.0]

- 新增三层热键模型，支持为 tmux window 操作配置快捷键。
- 修复 lint 检查中的空函数问题。

## [1.3.1]

- 修复冷启动后首次进入 tmux mode 需要等待数秒的问题。

## [1.3.0]

- 新增 session 级搜索面板，替代各 pane 独立搜索。
- 改进 attach 后的 window 顺序、活动 window 恢复、pane 光标和尺寸恢复。
- 优化 zoom 交互，并支持按当前 window 或所有 window 同步 pane 输入。
- 修复四字节 UTF-8 字符解码问题，并增强自动化测试和开发检查工具。

## [1.2.1]

- 修复重新 attach 或切换 window 后活动 pane/window 状态不正确的问题。
- 新增隐藏 window 标签关闭按钮的设置，并改进标签最小宽度以减少误关闭。
- 配置发布时自动创建 GitHub Release 并生成变更摘要。

## [1.2.0]

- 新增 pane overlay scrollbar，并支持交互滚动。
- 改进 focused pane 透明度及 window bar 的主题配色。
- 修复非活动 pane 接收快捷键输入的问题。

## [1.1.1]

- 右键点击 tmux pane 时遵循 Tabby 的 `terminal.rightClick` 设置。

## [1.1.0]

- 重写 pane 分割布局算法，并增加布局留白。
- 改进 pane/window 关闭后的焦点切换及 pane zoom 处理。
- 由 tmux 绘制 pane 分隔线，避免与插件界面重复。

## [1.0.1]

- 首个版本：通过 tmux Control Mode 将 session、window 和 pane 集成到 Tabby 原生界面。
- 支持 pane 输入输出、多 pane 布局、window 切换和创建，以及 tmux window bar。
- 支持进入和退出 tmux mode、恢复活动 window/pane 与终端历史，并提供设置面板和日志开关。
- 支持 trzsz，并在启动 tmux 时启用 `-J` 以正确处理终端回退字符。
