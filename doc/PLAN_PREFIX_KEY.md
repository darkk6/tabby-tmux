# 计划：tmux prefix key 与指令 overlay

> 2026-10-29 经 grilling 定案。实现时以本文为准；实现完成后把结论并入 DESIGN_KEYBINDINGS.md 新章节。

## 目标

在 tmux mode 下找回 `prefix + 单键` 的 tmux 操作习惯。按下 prefix 后显示 overlay 列出可用的第二键；第二键直接调用插件已有的动作方法，不经 Tabby 热键系统。

## 冲突查核结论

- Ctrl-B 在 Tabby 的 Windows/Linux、macOS 默认热键、tabby-electron 与本插件 `tmuxPlugin.*` 中均未绑定，无直接冲突。
- 不能走 `HotkeyProvider`：Tabby 热键全局生效，xterm 前端对 partial-match 的键一律 `preventDefault`，会吞掉普通终端里的 Ctrl-B（readline backward-char、vim/less page-up、嵌套 tmux 的 prefix）。
- 不能用 Tabby 原生多键序列：`HotkeysService.lastKeystrokes` 永不过期且匹配允许中间夹杂其他键，无法实现"按错键即取消"。
- 本计划推翻 DESIGN_KEYBINDINGS.md 中"插件设置页不放键位表单"的决策：prefix 不出现在 Tabby Hotkeys 页面，插件设置页成为唯一入口，不构成双入口。

## 行为变更声明

control mode 下按键经 `send-keys` 直达 pane，tmux 本身不解析 prefix。实现后在 tmux mode 中 prefix 键不再直达 pane，需用 `prefix prefix` 发送原键（与 tmux `send-prefix` 语义一致）。

## 决策

### 机制
- 在 session tab 的 host 元素（`TmuxSessionTabComponent`，`installPrefixKeyListener`）挂 capture-phase `keydown` 监听，先于 xterm 的 `attachCustomKeyEventHandler`（textarea）和 Tabby `HotkeysService`（document bubble）执行。实现时从计划中的"每个 pane host 各挂一个"改为 session 级单一监听 + `.pane-area.contains(event.target)` 判定：pane 频繁增删，单一监听更稳，效果等价。
- 仅当按键目标在 `.pane-area` 内（即 tmux pane 的 xterm 持有键盘焦点）时生效；window bar、搜索面板、改名 / 确认对话框是 pane-area 的兄弟节点，不触发。
- 等待第二键的状态（`prefixPending`）与 overlay 属于 session tab 级别。
- overlay 渲染在 `.pane-area` 内部（`inset: 0`），只盖 pane 区域不盖 window bar。`bar` 版**会覆盖 pane 底部几行**而不是把 pane 挤上去：挤上去会缩小 pane-area → `refresh-client` → tmux 每按一次 prefix 就重排布局。

### prefix 键
- 默认 `Ctrl-B`，Windows / Linux / macOS 相同。
- 配置键 `tmuxPlugin.prefixKey`，存 Tabby keystroke 字符串（`getKeyName` 命名）。
- 设置页：录制按钮（"按下按键以设定"）+ "重设为 Ctrl-B"。
- 验证：必须包含 Ctrl / Alt / ⌘ 之一；无修饰键或仅 Shift 的组合拒绝保存。
- 与 `config.store.hotkeys` 中已绑定的键冲突时显示警告，允许保存（tmux pane 内 prefix 优先，原热键失效）。

### 第二键（写死，不可配置）
第二键直接调用动作方法；Ctrl 按住不放时的组合视为等价（`c` ≡ `Ctrl-C`）。

| 键 | 动作 | 调用 |
|---|---|---|
| `c` | 新建 window | `onCreateWindow()` |
| `n` / `p` | 下一个 / 上一个 window | `switchWindowByOffset(±1)` |
| `0`–`9` | 跳到 tmux index 为 N 的 window | 按 `WindowState.index` 查找后 `enqueueSwitchToWindow` |
| `d` | detach | `TmuxService.disconnectContext()`（toggle 的退出方向） |
| `%` / `"` | 向右 / 向下分割 | `splitTab` 重路由（`split-window -h` / `-v`） |
| 方向键 | 选该方向的 pane | `navigate` 重路由（`select-pane -L/-R/-U/-D`） |
| `o` | 下一个 pane | `navigateLinear` 重路由 |
| `z` | zoom pane | `handlePaneMaximizeHotkey` 路径 |
| `x` | 关闭 pane | 确认对话框后 `controller.killPane` |
| `&` | 关闭 window | 确认对话框后 window bar 的关闭路径 |
| `,` | 重命名 window | 现有改名对话框 |
| prefix | 发送原始 prefix 键到 pane | `send-keys` 当前配置的 prefix |

明确排除（插件未实现，不新增）：`l`、`w`、`[`、`:`、Space、`{`/`}`、`!`、`$`、`s`、resize（`C-方向键` / `M-方向键`，用户用鼠标拖拽）。

### 关闭规则
- 无超时。
- Esc、任意键（含未支持键）、pane 失焦（点击别处、切换 tab）均关闭并清除等待状态。
- 未支持的键吞掉，不送入 pane。
- 不做 tmux `-r` 连按。

### 与现有热键的关系
`Ctrl-Shift-[` / `]` / `1..9` / `B` / `X` 保留并存，prefix 是加法。

### overlay
两版都做，设置页下拉 `tmuxPlugin.prefixOverlayStyle`：`bar` | `modal`。原计划比较后移除输家；2026-10-30 实机比较后决定**两版都正式保留**，设置项保留。
- `bar`：which-key 风格，贴 session tab 底部横向一条，分 Windows / Panes / Session 三组多栏，标题显示当前 prefix 键。不遮 pane 内容，无动画。
- `modal`：半透明暗底遮罩盖住 pane 区域（不盖 window bar），居中卡片列同样三组；点击遮罩等同 Esc。

### 附带
- window bar 标签加 tmux index 前缀（`3:build`），使数字键可预期。
- i18n 补 en 与 zh-CN。
- 键 → 动作映射做成纯函数模块并补 vitest。
- DESIGN_KEYBINDINGS.md 新增章节记录本决策。

## 手动验证清单
- [ ] 普通终端按 Ctrl-B：字符正常进入 shell（readline backward-char），无 overlay
- [ ] tmux pane 按 prefix：overlay 出现；按 `p` 切到上一个 window 且 overlay 关闭
- [ ] prefix 后按 `Ctrl-N`：等同 `n`
- [ ] prefix 后按未支持键（如 `q`）：overlay 关闭，pane 未收到 `q`
- [ ] prefix 后按 Esc / 点击 window bar / 切 tab：overlay 关闭
- [ ] prefix prefix：pane 收到原始 prefix 键（如 vim 中 Ctrl-B 翻页）
- [ ] 改 prefix 为 Ctrl-A 后：Ctrl-B 直达 pane，Ctrl-A 触发 overlay，overlay 标题显示 Ctrl-A
- [ ] 录制无修饰键的字母：拒绝；录制 Ctrl-Shift-X：警告但可保存
- [ ] `x` / `&`：弹确认，取消不杀
- [ ] `3`：跳到 tmux index 3，window bar 标签显示 `3:name`
- [ ] 设置页切换 bar / modal：无需重启即生效
- [ ] 现有 Ctrl-Shift-] 仍可用
