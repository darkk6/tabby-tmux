# tabby-tmux（darkk6 分支）

這是 [ruanimal/tabby-tmux](https://github.com/ruanimal/tabby-tmux) 的個人修改版：一個讓 [Tabby](https://tabby.sh/) 以 tmux Control Mode 整合 tmux 的 plugin。

- 原始專案的說明（功能、需求、安裝、設定、快捷鍵）請看 [UPSTREAM_README.md](UPSTREAM_README.md)（英文）或 [README.zh-CN.md](README.zh-CN.md)（簡體中文）。
- 本分支每一項改動的細節、原因與驗證方式在 [BRANCH_CHANGES.md](BRANCH_CHANGES.md)。
- 各版本的發布紀錄在 [BRANCH_CHANGELOG.md](BRANCH_CHANGELOG.md)。
- 建置、部署與 GitLab CI 發布流程在 [doc/BUILD_AND_RELEASE.md](doc/BUILD_AND_RELEASE.md)。

`master` 分支維持與 upstream 同步，所有個人修改都只放在 `darkk6`。

## 本分支的改動

| #   | 改動                                                                                             | 設定鍵                                                   | 細節                                                                       |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | **Force English UI**：plugin 介面可強制英文，不再因 `zh-TW` 被對應到簡體中文                     | `tmuxPlugin.forceEnglish`                                | [§1](BRANCH_CHANGES.md#1-force-english-uidd3fe43)                          |
| 2   | **進入 tmux mode 前詢問 session 名稱**：右鍵選單與熱鍵都先跳出對話框，預設帶入設定值             | 沿用 `tmuxPlugin.defaultSessionName`                     | [§2](BRANCH_CHANGES.md#2-進入-tmux-mode-前詢問-session-名稱d071dceadb5d87) |
| 3   | **tmux prefix key 與按鍵提示 overlay**：在 pane 內找回 `prefix + key`（`c`、`n`/`p`、`%`、`z`…） | `tmuxPlugin.prefixKey` / `tmuxPlugin.prefixOverlayStyle` | [§3](BRANCH_CHANGES.md#3-tmux-prefix-key-與按鍵提示-overlayb1ff9b3a4cc4c1) |
| 4   | **視窗分頁顯示 tmux window index**：分頁標籤改為 `<index>:<name>`                                | -                                                        | [§4](BRANCH_CHANGES.md#4-視窗分頁顯示-tmux-window-indexa7fbdd5)            |
| 5   | **加大視窗分頁列**：14px 字級、28px 高的分頁                                                     | -                                                        | [§5](BRANCH_CHANGES.md#5-加大視窗分頁列8337ad0)                            |
| 6   | **Home/End 在 tmux pane 內可用**：修正按鍵沒送出、送出後 zsh 又認不得的兩層問題                  | -                                                        | [§6](BRANCH_CHANGES.md#6-homeend-在-tmux-pane-內無效bdd0e5c)               |
| 7   | **隱藏的 tmux mode 分頁不再搶鍵盤焦點**：另一分頁用 TUI tmux 操作同一 session 時不會失去焦點     | -                                                        | [§7](BRANCH_CHANGES.md#7-隱藏的-tmux-mode-分頁不再搶鍵盤焦點db0e574)       |
| 8   | **中文等多位元組字元不再顯示成 �**：`%output` 與封包邊界切到 UTF-8 字元中間時正確重組            | -                                                        | [§8](BRANCH_CHANGES.md#8-中文等多位元組字元不再顯示成-5721e8b)             |
| 9   | **prefix 鍵加入 layout / 交換 / 輪轉**：`Space`、`M-1`–`M-5`、`E`、`{` / `}`、`C-o` / `M-o`      | -                                                        | [§9](BRANCH_CHANGES.md#9-prefix-鍵加入-layout--交換--輪轉6a9902c)          |
| 10  | **close-pane 熱鍵真的關掉 tmux pane**：不再只從畫面消失、卻仍在 tmux 裡執行                      | -                                                        | [§10](BRANCH_CHANGES.md#10-close-pane-熱鍵真的關掉-tmux-pane629f322)       |
| 11  | **建置腳本與 GitLab CI**：`scripts/build.sh`、`BUILD_NUMBER` 流水號版本、test → build → release  | -                                                        | [doc/BUILD_AND_RELEASE.md](doc/BUILD_AND_RELEASE.md)                       |

## 安裝

到 GitLab 的 **Deploy → Releases** 下載 `tabby-tmux-<version>.tgz`，關閉 Tabby，解壓到 Tabby 的 `plugins/node_modules/`（會覆蓋既有的 `tabby-tmux/`），再啟動 Tabby。各平台路徑與其他方式見 [doc/BUILD_AND_RELEASE.md](doc/BUILD_AND_RELEASE.md#使用者如何安裝)。

版本號格式為 `<upstream 版本>+[local-]<branch>-<流水號>`，例如 `1.6.1+darkk6-00012`；`+` 之後是 semver build metadata，Tabby 的 plugin 管理員不會把 npm 上的同版本當成可升級而蓋掉它。

## 開發

```bash
pnpm install
pnpm run build              # webpack → dist/
scripts/build.sh --deploy   # 建置並裝進本機 Tabby，之後重啟 Tabby
pnpm test                   # vitest
```

開發規範見 [AGENTS.md](AGENTS.md)，分支專屬的注意事項見 [CLAUDE.md](CLAUDE.md)。
