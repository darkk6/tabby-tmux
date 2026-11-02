# 建置、部署與發布

本文件說明 `darkk6` 分支的建置腳本、版本號規則與 GitLab CI 發布流程。
GitLab repo：<https://git.synology.inc/luchunpan/tabby-tmux>。

## 版本號

```
<upstream-version>+[local-]<branch>-<build-number>
```

| 欄位               | 來源                                                                   | 範例                     |
| ------------------ | ---------------------------------------------------------------------- | ------------------------ |
| `upstream-version` | `package.json` 的 `version`，跟著 upstream `master` 走                 | `1.6.1`                  |
| `local-`           | 只有本機建置才有；GitLab CI 建置沒有                                   | `local-`                 |
| `branch`           | 目前的 branch 名稱，`[0-9A-Za-z.-]` 以外的字元換成 `-`                 | `darkk6`、`feature-foo`  |
| `build-number`     | repo 根目錄 `BUILD_NUMBER` 檔案裡的五位流水號；只增不減，upstream 升版也不歸零 | `00012`                  |

- 本機：`1.6.1+local-darkk6-00012`
- CI：`1.6.1+darkk6-00012`，release tag 為 `v1.6.1+darkk6-00012`

`+` 之後是 semver build metadata，與純 `1.6.1` 視為相等，所以 Tabby 的 plugin 管理員不會把 npm 上的 1.6.1 當成「可升級」而蓋掉本機版本（若用 `-` 會被視為 pre-release、比 1.6.1 舊）。

## 本機建置與部署（`scripts/build.sh`）

Windows Git Bash、macOS、Linux 皆可直接執行；需要 `node`、`pnpm`、`git`、`tar`。

```bash
scripts/build.sh            # pnpm run build → out/tabby-tmux/（package.json + dist/）與 out/tabby-tmux-<version>.tgz
scripts/build.sh --deploy   # 建置後再複製到 Tabby 的 plugins/node_modules/tabby-tmux/，之後重啟 Tabby
scripts/build.sh --no-build # 沿用現有 dist/，不重跑 webpack（可與 --deploy 併用）
scripts/build.sh version    # 只印出這次會產生的版本號
scripts/build.sh bump       # BUILD_NUMBER +1
```

部署目標依平台自動判斷（可用環境變數 `TABBY_USER_DATA` 覆寫）：

| 平台    | Tabby user data                        |
| ------- | -------------------------------------- |
| Windows | `%APPDATA%\tabby`                      |
| macOS   | `~/Library/Application Support/tabby`  |
| Linux   | `$XDG_CONFIG_HOME/tabby`（預設 `~/.config/tabby`） |

第一次部署時會把原本 npm 安裝的 `dist/` 備份到 `dist.npm-backup/`，方便手動還原。
寫進 plugin 目錄的 `package.json` 另帶 `buildInfo`（branch、sha、dirty、builtAt、ci、pipeline），即使版本號相同也能追到是哪一次建置。

## GitLab CI（`.gitlab-ci.yml`）

Runner tag `instance-runner`，image `node:22.20.0-bookworm-slim`（alpine 沒有 bash；要釘在不再更新的 patch tag，因為 `docker-mirror.synology.inc` 拒絕 7 天內 push 的 image，而 `node:22-slim` 這類 floating tag 幾天就重建一次），npm registry 走 `https://npm.synology.inc`（`NODE_EXTRA_CA_CERTS` 使用 runner 提供的 `$SYNO_INTRANET_CA`）。

| Stage     | Job       | 何時執行                                 | 內容                                                                  |
| --------- | --------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `test`    | `test`    | 每次 push、手動 Run pipeline             | `pnpm install --frozen-lockfile`、lint、typecheck、format:check、test |
| `build`   | `build`   | test 通過後                              | `scripts/build.sh`；`out/` 保存為 artifact 兩週                       |
| `release` | `release` | 只在 Run pipeline 的 input `build_type` 選 `release` | `scripts/release.mjs`，見下                                           |

Tag pipeline 一律不跑（`workflow.rules`），避免 release 建出的 tag 又觸發一次 pipeline。

### 發布流程

1. 在要發布的 branch 上 `scripts/build.sh bump`，commit `BUILD_NUMBER`（例如 `chore(release): build 00012`）並 push。
2. GitLab → Build → Pipelines → **Run pipeline**，選 branch，Inputs 的 `build_type` 選 `release`（`spec:inputs` 定義，push 觸發的 pipeline 用預設值 `build`）。
3. `release` job 會：
    1. 檢查 Release `v<version>` 是否已存在，存在就 fail（代表忘了 bump）。
    2. 把 `out/tabby-tmux-<version>.tgz` 上傳到 **Deploy → Package registry**（generic package `tabby-tmux`，version 同版本號）。
    3. 用 Releases API 建立 tag + Release，Release 附上該 tgz 的下載連結與安裝步驟。
       若同名 tag 早已存在而指向別的 commit，會把剛建的 Release 刪掉並 fail。

全部只用 `CI_JOB_TOKEN`，不需要另外設 access token（job token 在 GitLab 17.11 讀不到 Tags API，所以用 Release 存在與否當第一道檢查）。

### 使用者如何安裝

到 **Deploy → Releases** 下載 `tabby-tmux-<version>.tgz`，關閉 Tabby，解壓到 `plugins/node_modules/`（tgz 內只有一個 `tabby-tmux/` 根目錄，會直接覆蓋既有資料夾），再啟動 Tabby。
也可以 `cd <Tabby user data>/plugins && npm install <tgz>`。

> 專案是 private，Package registry 的檔案需要至少 Reporter 權限才能下載。
