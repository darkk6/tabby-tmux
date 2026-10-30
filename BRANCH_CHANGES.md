# darkk6 分支改動說明

本分支是 [ruanimal/tabby-tmux](https://github.com/ruanimal/tabby-tmux) 的個人修改版，基底為 upstream `master`（v1.6.1 + 一個 docs commit，`431584d`）。
`master` 分支維持與 upstream 同步，所有個人修改都只放在 `darkk6`。

本地建置與部署方式見 `deploy-tabby-tmux.sh`（repo 外），版本號格式為 `1.6.1+local-darkk6-<MMDD-HHMMSS>`，
以 `+` build metadata 的方式附加，避免 Tabby 的 plugin 管理員把它當成舊版而要求升級。

## 功能一覽

| 功能 | 設定鍵 | 預設值 | 相關 commit |
|---|---|---|---|
| Force English UI | `tmuxPlugin.forceEnglish` | `false` | `dd3fe43` |
| 進入 tmux mode 前詢問 session 名稱 | 無（沿用 `tmuxPlugin.defaultSessionName`） | - | `d071dce`, `adb5d87` |
| tmux prefix key 與按鍵提示 overlay | `tmuxPlugin.prefixKey` / `tmuxPlugin.prefixOverlayStyle` | `Ctrl-B` / bottom bar | `b1ff9b3`, `a4cc4c1` |
| 視窗分頁顯示 tmux window index | 無 | - | `a7fbdd5` |
| 加大視窗分頁列 | 無 | - | `8337ad0` |

## 1. Force English UI（`dd3fe43`）

Tabby 會把所有 `zh-*` locale（含 `zh-TW`）對應到本 plugin 的簡體中文字串。
新增 `tmuxPlugin.forceEnglish` 設定，勾選後 plugin 介面強制使用英文，取消勾選則回到跟隨 Tabby locale。

- 即時生效：透過既有的 `TmuxConfigChangeService -> languageChange$` 鏈，不需重啟。
- 修改檔案：`src/components/settings.component.ts`、`src/services/tmuxI18n.service.ts`、`src/config.ts`、`src/i18n.ts`。

## 2. 進入 tmux mode 前詢問 session 名稱（`d071dce`、`adb5d87`）

tab 右鍵選單的「Enter Tmux Mode」與切換熱鍵的「進入」方向，現在會先跳出 modal 詢問 session 名稱。

- 預設帶入 `tmuxPlugin.defaultSessionName`，文字預先全選，`Enter` 確認、`Esc` 或點擊背景取消。
- 含有空白、`.`、`:`、`;` 的名稱無法送出（tmux 或 shell 會把它們弄壞）；其他名稱會先經過 shell quoting 再交給 `tmux -CC new -A -s`。
- 對話框開啟期間再次觸發會被忽略；設定中的預設名稱永遠不會被覆寫。
- 使用 `NgbModal` 開啟：此時 host 仍是 Tabby 自己的 terminal tab，rename 用的 in-tab overlay 無處可渲染。
- `adb5d87` 修正：在 Angular zone 內填入對話框內容。原本在 `zone.run()` 之外賦值會先渲染出空白對話框，且預填名稱不再是選取狀態。
- 新增檔案：`src/components/tmuxSessionNameDialog.component.ts`、`src/services/tmuxSessionNamePrompt.service.ts`、`src/tmuxSessionName.ts`（含各自的 spec）。

## 3. tmux prefix key 與按鍵提示 overlay（`b1ff9b3`、`a4cc4c1`）

在 tmux mode 內找回 tmux 的 `prefix + key` 操作習慣。設計細節與衝突分析見 `doc/PLAN_PREFIX_KEY.md`，
`doc/DESIGN_KEYBINDINGS.md` 新增「第四層」章節說明。

### 攔截方式

- prefix 預設 `Ctrl-B`，以 Tabby keystroke 語法存在 `tmuxPlugin.prefixKey`，**刻意不放在 `hotkeys` 底下**。
- 由 session tab host 上的 capture-phase `keydown` 監聽器攔截，只對 pane 區域內的按鍵作用，
  因此不會變成全域 Tabby hotkey（那會吃掉每個 terminal 的 `Ctrl-B`），也不會出現在 Tabby Settings → Hotkeys。
- 不採用 Tabby 原生多段 hotkey：其 keystroke 歷史永不過期，無法表達「任何其他鍵即取消」。

### 第二鍵對應（固定為 tmux 自己的綁定，與 `tmuxPlugin.*` hotkey 設定無關）

| 鍵 | 動作 |
|---|---|
| `c` | 新視窗 |
| `n` / `p` | 下一個 / 上一個視窗 |
| `0`–`9` | 依 tmux window index 切換視窗 |
| `,` | 重新命名視窗 |
| `&` | 關閉視窗（會先確認） |
| `%` / `"` | 向右 / 向下分割 |
| `←↑↓→` | 選擇 pane |
| `o` | 下一個 pane |
| `z` | 切換 zoom |
| `x` | 關閉 pane（會先確認） |
| `d` | detach（離開 tmux mode） |
| prefix 再按一次 | 把 prefix 本身送進 pane（走 pane input 路徑） |

- `Esc`、任何不支援的鍵、滑鼠點擊或失去 tab 焦點都會取消。
- 第二鍵時 Ctrl 可以不放開（`Ctrl-B Ctrl-N` 等同 `Ctrl-B n`）；字母大小寫敏感，與 tmux 一致。
- `x` 與 `&` 比照 tmux 的 `confirm-before` 先詢問（新增 `tmuxConfirmDialog.component.ts`）。

### Overlay 與設定頁

- 等待第二鍵時顯示可用按鍵列表，`tmuxPlugin.prefixOverlayStyle` 可選底部 bar 或置中 modal（兩種都保留）。
- plugin 設定頁新增 prefix 錄製器（必須含 Ctrl 或 Alt，會警告將被遮蔽的 Tabby hotkey）與 overlay 樣式選擇器。
- 新增檔案：`src/tmuxPrefix.ts`、`src/components/tmuxPrefixOverlay.component.ts`、`src/components/tmuxConfirmDialog.component.ts`（含 spec）。
- 兩份 README 都補上 prefix 鍵表。

## 4. 視窗分頁顯示 tmux window index（`a7fbdd5`）

視窗分頁改為 `<index>:<name>` 格式，與 tmux status line 一致，讓 `prefix <數字>`（依 `#{window_index}` 而非分頁位置選取）的結果可預期。

- index 尚未知的視窗維持只顯示名稱。
- 分頁列的 change signature 納入 label，因此 `move-window` 重新編號後，與 rename 一樣會重新顯示作用中的分頁。
- 修改檔案：`src/components/tmuxWindowBar.component.ts`。

## 5. 加大視窗分頁列（`8337ad0`）

分頁列設定絕對 14px 字級，內部所有尺寸改用 em 表示，分頁（現為 28px 高）、badge 與按鈕隨這一個數字一起縮放。

## 驗證狀態

- `pnpm run typecheck`、`lint`（0 errors）、`build`、`vitest`（451 passed）皆通過。
- `pnpm run format:check` 在此 CRLF checkout 上會整庫失敗，與本分支無關；被改到的檔案以 `prettier --check --end-of-line auto` 檢查通過。
- 鍵盤互動在 Tabby 1.0.238 內手動驗證；`doc/PLAN_PREFIX_KEY.md` 的手動 checklist 未在建置機上全數跑過。

## 改動統計

相對 `master`：31 個檔案，+2955 / -51 行。
