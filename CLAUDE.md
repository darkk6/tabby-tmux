# CLAUDE.md — darkk6 分支

給在這個 checkout 工作的 Claude 看。upstream 的開發規範（術語、commit 格式、檢查項目）在 [AGENTS.md](AGENTS.md)，一樣要遵守；這裡只寫 upstream 文件沒有、而這個分支需要知道的事。

## 這個 repo 是什麼

- [ruanimal/tabby-tmux](https://github.com/ruanimal/tabby-tmux) 的個人 fork。`master` 與 upstream 同步，所有個人改動只放在 `darkk6`；不要往 upstream push。
- Remotes：`origin` = `git@git.synology.inc:luchunpan/tabby-tmux.git`（主要，GitLab CE 17.11，project id 45312，default branch `darkk6`）；`darkk6` = `https://github.com/darkk6/tabby-tmux.git`（備份，每次 push 兩邊都推）；`upstream` = ruanimal。
- 文件分工：[README.md](README.md) 是分支改動總覽；[BRANCH_CHANGES.md](BRANCH_CHANGES.md) 是每項改動的細節；[BRANCH_CHANGELOG.md](BRANCH_CHANGELOG.md) 是發布紀錄；[UPSTREAM_README.md](UPSTREAM_README.md) / [README.zh-CN.md](README.zh-CN.md) 是 upstream 原文，不要改內容；[doc/BUILD_AND_RELEASE.md](doc/BUILD_AND_RELEASE.md) 是建置與發布流程。
- 與使用者溝通和分支文件用繁體中文；程式碼、commit 訊息、script 註解用英文（依 AGENTS.md）。

## 新增一項改動時要做的事

1. 程式碼 + spec，跑 `pnpm run lint`、`pnpm run typecheck`、`pnpm test`、`pnpm run build`。
2. 在 [BRANCH_CHANGES.md](BRANCH_CHANGES.md) 加一節（原因、修法、改到的檔案、驗證），並更新開頭的功能一覽表。
3. 在 [README.md](README.md) 的改動表加一列，連到該節。
4. 在 [BRANCH_CHANGELOG.md](BRANCH_CHANGELOG.md) 的 `[Unreleased]` 加一行。
5. Conventional Commit，push 到 `origin` 與 `darkk6`。

## 建置、部署、發布

- 本機：`scripts/build.sh --deploy`（Git Bash）建置並複製到 `%APPDATA%\tabby\plugins\node_modules\tabby-tmux`，之後要重啟 Tabby（plugin 只在啟動時載入）。Tabby 1.0.238 裝在 `%LOCALAPPDATA%\Programs\Tabby`。
- 版本 `<package.json version>+[local-]<branch>-<BUILD_NUMBER>`；`BUILD_NUMBER` 是 repo 裡的五位數檔案，只在發布前用 `scripts/build.sh bump` 手動加一，本機建置不會自動遞增。`+` build metadata 讓 Tabby 不會把 npm 的同版本當成升級，不要改成 `-`。
- 發布：bump → 更新 BRANCH_CHANGELOG → commit、push → GitLab Run pipeline，input `build_type=release`。`scripts/release.mjs` 只用 `CI_JOB_TOKEN`，會上傳 tgz 到 generic package registry 並建 tag + Release；Release 已存在就 fail。Release 是對外動作，先問過使用者再觸發。
- 對 plugin 目錄下的 `package.json` 只動 `version` 與 `buildInfo`，repo 的 `package.json` 版本跟著 upstream，不要自己改。

## GitLab CI 的坑

- Runner tag `instance-runner`（Kubernetes executor，無 dind）。Image 走 `docker-mirror.synology.inc`，它拒絕 7 天內 push 的 image，所以 `NODE_IMAGE` 必須釘在不再更新的 patch tag（目前 `node:22.20.0-bookworm-slim`），不能用 `node:22-slim` 這種 floating tag。
- image 要有 `bash`（`scripts/build.sh` 用到），alpine 不行；slim 沒有 `git`、`curl`，所以 release 邏輯用 node 的 `fetch` 寫。
- npm registry 走 `https://npm.synology.inc`；對 `git.synology.inc` 的 HTTPS 要 `NODE_EXTRA_CA_CERTS=$SYNO_INTRANET_CA`（runner 已提供）。
- Job token 在 17.11 只能用 Releases 與 Packages API，讀不到 Tags API；同名 tag 的檢查因此是「Release 是否存在」加「建立後比對 commit」兩段。
- 驗證 `.gitlab-ci.yml`：MCP 的 token 沒有 `api` scope，改在瀏覽器登入狀態下對 `/api/v4/projects/45312/ci/lint` 用 `fetch` 加 `X-CSRF-Token`。
- `workflow.rules` 排除 tag pipeline，否則 release 建的 tag 會再觸發一次。

## 本機環境的坑

- Working copy 是 CRLF（`core.autocrlf=true`），`pnpm run format:check` 整庫都會紅；只對改到的檔案跑 `pnpm exec prettier --check --end-of-line auto <files>`。CI 是 LF checkout，`format:check` 在那裡必須過，所以新檔案一樣要符合 prettier（4 空格、單引號、無分號、100 欄）。
- Git Bash 裡 POSIX 路徑（`/d/...`）只有當作獨立參數傳給 node 時 MSYS 才會轉成 Windows 路徑；放在 `node -p "..."` 字串裡不會轉，要先 `cd` 再用相對路徑。
- 寫含反斜線或非 ASCII 的檔案用 Write 工具，不要用 Bash heredoc。
- 整合與效能測試（`paneSnapshot.integration` / `performance`）需要 tmux，本機與 CI 都會被 skip，屬正常。
- `~/.npmrc` 指向 `npm.synology.inc` 並帶 cafile；Tabby 內建的 plugin 安裝不吃這個設定。
