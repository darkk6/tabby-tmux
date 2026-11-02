# darkk6 分支發布紀錄

記錄 `darkk6` 分支每一個發布版本（GitLab Release）面向使用者的變更，由新到舊。
版本號即 Release tag 去掉 `v`，格式見 [doc/BUILD_AND_RELEASE.md](doc/BUILD_AND_RELEASE.md)。
改動的實作細節在 [BRANCH_CHANGES.md](BRANCH_CHANGES.md)；upstream 自己的版本紀錄在 [CHANGELOG.md](CHANGELOG.md)。

發布前：`scripts/build.sh bump`，把 `[Unreleased]` 改成新版本號與日期，連同 `BUILD_NUMBER` 一起 commit，再以 `build_type=release` 執行 pipeline。
`scripts/release.mjs` 會把對應版本的段落放進 GitLab Release 的說明。

## [Unreleased]

基底 upstream v1.6.1（`431584d`）。

### 新增

- Force English UI 設定（`tmuxPlugin.forceEnglish`）。
- 進入 tmux mode 前先詢問 session 名稱。
- tmux prefix key（預設 `Ctrl-B`）與第二鍵提示 overlay（底部 bar 或置中 modal）。
- 視窗分頁標籤顯示 tmux window index（`<index>:<name>`）。
- 加大視窗分頁列。
- `scripts/build.sh` 建置／部署腳本與 GitLab CI（test → build → release）。

### 修正

- Home / End 在 tmux pane 內無效。
- 隱藏的 tmux mode 分頁搶走鍵盤焦點。
- 中文等多位元組字元在 pane 內顯示成 �。
