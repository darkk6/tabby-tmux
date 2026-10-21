# Pane 屏幕恢复

## 问题

Vim 使用 alternate screen 时，普通 `capture-pane` 的可见部分是 Vim 当前画面，`capture-pane -a` 则是进入 Vim 前保存的普通屏幕。旧实现将两者写入相反的 xterm buffer，还把逻辑行数当作屏幕行数计算光标位置。

## 实施计划

- [x] 将 scrollback、活动屏幕、保存的普通屏幕与终端状态分开建模，校验快照采集过程中的尺寸和屏幕切换，捕获失败时不恢复错误文本。
- [x] 让历史和普通屏幕保留软折行语义，按物理行绘制 alternate screen；正确恢复保存的光标与终端模式，接续快照之后的实时输出。
- [x] 修正 resize 恢复流程，防止旧快照覆盖新的 Vim 输出或将已经退出 Vim 的 pane 切回 alternate screen。
- [x] 增加真实 xterm buffer 回归测试，并用 tmux 3.1/3.5a 和 Vim 验证 attach、编辑、resize、退出 Vim 与历史边界。
- [x] 完成全量测试、lint、typecheck、format 和构建检查。

最低版本保持 tmux 3.1；屏幕捕获保留 `-N`，不引入兼容旧版 tmux 的降级分支。

## 恢复设计

| 数据                  | 捕获方式                                               | 写入方式                                                     |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Scrollback            | `capture-pane -peJN -S- -E-1`；`history_size=0` 时跳过 | 写入 normal buffer，保留空行、重复行和软折行                 |
| 普通屏幕              | `capture-pane -peJN -S0`；`alternate_on=1` 时加 `-a`   | 接续 scrollback；保留 `-J`，使 xterm 能重建软折行            |
| 当前 alternate screen | `capture-pane -peN -S0`；仅在 alternate 模式下请求     | 暂停自动换行，按物理行定位绘制，避免底行滚动                 |
| 终端状态              | 捕获前后分别 `list-panes -F`                           | 绘制完成后恢复光标、滚动区域、origin、insert、键盘和鼠标模式 |

额外捕获历史最后一个物理行与屏幕第 0 行的片段（`-S-1 -E0`），根据两行之间是否有换行判断软折行，避免重复传输完整历史，也避免在边界插入多余换行。`capture-pane -a` 的 saved grid 不包含 scrollback，因此历史始终从普通的 `capture-pane` 请求读取。

捕获命令与结束状态查询一起发送。捕获前后尺寸、normal/alternate 模式或历史有无发生变化时重试，最多三次；普通光标移动与 history size 增长不触发重传。使用结束状态恢复终端模式，捕获错误或超时不追加历史重试，也不能当作屏幕内容恢复。活动屏幕响应结束时同步记录 `%output` 序号，快照只覆盖该序号及以前的输出，之后的输出按原顺序接续。即使响应与后续 `%output` 在同一个数据包中，也能保留正确边界。采集失败则保留缓冲的实时输出；销毁后完成的采集不能交给重新挂载的 pane。

快照通过独立的写入入口渲染，不经过实时输出的标题序列过滤器，避免尚未收完的 `ESC k ... ESC \\` 将整份快照误吞为标题内容。实时输出一直缓冲到快照返回其覆盖序号后，再筛选和接续。

恢复 Vim 时，先恢复普通屏幕与保存的光标，再通过 `1049h` 进入 alternate screen，最后绘制 Vim 的当前画面。resize 只调整当前 xterm grid，由实时输出提供应用重绘，不再重放 attach 时保存的内容。

tmux 3.1 对隐藏 normal grid 的缩放与 xterm 不一致；attach 前发生过 resize 时，saved grid 也可能仍保留旧尺寸。因此首次从 alternate 回到 normal、以及 alternate 内 resize 后回到 normal 时，重新抓取 tmux 当前的普通屏幕，恢复其实际内容与光标。不向 Vim 注入按键。

## 颜色恢复

`capture-pane -e` 的 SGR 序列由屏幕单元格生成，不代表应用在捕获时的当前绘制属性。例如 htop 底部快捷键栏为青色，但应用画完后已经重置颜色；捕获文本仍以青色结束。直接重放会让后续局部刷新、清除行尾和 resize 继承快捷键栏的颜色，形成多余色块。因此在进入 alternate screen 保存普通光标前、以及整个快照绘制结束时，重置 SGR，隔离快照与实时输出。

历史中的换行也只是捕获后的行分隔符，不能等同于原始输出中的 LF/SGR 顺序。直接带着上一行的背景色换行滚动，会让 xterm 用该颜色创建新的空白行。恢复时先用默认背景换行，再恢复捕获数据沿用的背景色；前景色、粗体等属性保持连续。背景状态识别支持 ANSI 普通/亮色、256 色和 RGB，且不会把扩展颜色参数中的数值误识别成重置或背景色代码。

## 验证

单元测试使用 `@xterm/headless` 6.0 检查实际 buffer 内容，覆盖 Vim 双屏幕、保存光标、全宽底行、中文、带背景色的尾部空格、空行、重复历史、软折行边界，以及快照与实时输出的顺序。

真实集成测试使用独立临时 tmux server、Vim 与生产恢复流程，对照 tmux 的实际画面和光标，覆盖以下四组组合，每组均执行 attach、编辑和退出 Vim：

| attach 前 resize | attach 后 resize | tmux 3.1 | tmux 3.5a |
| ---------------- | ---------------- | -------- | --------- |
| 否               | 否               | 通过     | 通过      |
| 否               | 是               | 通过     | 通过      |
| 是               | 否               | 通过     | 通过      |
| 是               | 是               | 通过     | 通过      |

集成测试默认跳过，指定二进制后运行：

```bash
TMUX_TEST_BINARY=/path/to/tmux pnpm test:integration
# 可选：VIM_TEST_BINARY=/path/to/vim；默认为 PATH 中的 vim

# 同时检查真实 htop 恢复、选中行局部刷新和 resize 后的逐单元格颜色
TMUX_TEST_BINARY=/path/to/tmux HTOP_TEST_BINARY=/path/to/htop pnpm test:integration
```

测试清理只针对自身创建的临时 server。上述验证使用真实 tmux/Vim 与 headless xterm，未执行 Tabby GUI 手工验收。

最终检查：245 项单元测试通过；tmux 3.1 和 3.5a 各 4 项真实 Vim 集成测试、1 项真实 htop 颜色集成测试通过。htop 测试将恢复内容与真实 tmux 捕获内容的每个单元格文字、前景色、背景色、反显、粗体和暗色属性对照。生产代码与测试代码 typecheck、Prettier、Webpack 构建通过；ESLint 无错误，保留基线已有的 135 项警告。
