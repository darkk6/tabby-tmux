#!/usr/bin/env bash
# Build tabby-tmux into an installable plugin folder, optionally deploy it into
# Tabby's plugin directory. Works in Git Bash (Windows), macOS and Linux, and in
# GitLab CI (which only needs the plain build).
#
# Usage:
#   scripts/build.sh                 build  -> out/tabby-tmux/ + out/tabby-tmux-<version>.tgz
#   scripts/build.sh --deploy        build, then copy out/tabby-tmux/ into Tabby's plugin dir
#   scripts/build.sh --no-build      skip `pnpm run build`, reuse the existing dist/
#   scripts/build.sh version         print the version this checkout would build
#   scripts/build.sh bump            increment BUILD_NUMBER (commit it before a release)
#
# Version scheme:  <upstream-version>+[local-]<branch>-<build-number>
#   upstream-version  "version" in package.json (follows upstream master, e.g. 1.6.1)
#   local-            present only outside GitLab CI
#   branch            current branch, non [0-9A-Za-z.-] characters become "-"
#   build-number      5-digit counter from the BUILD_NUMBER file; never resets
#   e.g. 1.6.1+local-darkk6-00012 (local)   1.6.1+darkk6-00012 (CI)   tag v1.6.1+darkk6-00012
#
# Everything after "+" is semver build metadata, which compares EQUAL to the plain
# upstream version, so Tabby's plugin manager will not offer the npm release as an
# "upgrade" over this build. (A "-" pre-release would compare lower and trigger it.)
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$repo/out"
stage="$out/tabby-tmux"

cmd=build
do_deploy=false
do_build=true
for arg in "$@"; do
    case "$arg" in
        --deploy) do_deploy=true ;;
        --no-build) do_build=false ;;
        version | bump) cmd="$arg" ;;
        -h | --help)
            sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "unknown argument: $arg" >&2
            exit 2
            ;;
    esac
done

# ---------------------------------------------------------------- version ----
read_build_number() {
    local n
    n="$(tr -d '[:space:]' < "$repo/BUILD_NUMBER")"
    if [[ ! "$n" =~ ^[0-9]{5}$ ]]; then
        echo "BUILD_NUMBER must contain a 5-digit number, got '$n'" >&2
        exit 1
    fi
    printf %s "$n"
}

if [[ "$cmd" == bump ]]; then
    current="$(read_build_number)"
    next="$(printf %05d $((10#$current + 1)))"
    printf '%s\n' "$next" > "$repo/BUILD_NUMBER"
    echo "BUILD_NUMBER: $current -> $next"
    exit 0
fi

upstream_version="$(cd "$repo" && node -p "require('./package.json').version.replace(/[+-].*$/, '')")"
build_number="$(read_build_number)"

if [[ -n "${GITLAB_CI:-}" ]]; then
    build_type=""
    branch="${CI_COMMIT_REF_NAME:?CI_COMMIT_REF_NAME is not set}"
    sha="${CI_COMMIT_SHORT_SHA:-${CI_COMMIT_SHA:0:8}}"
    dirty=false
else
    build_type="local-"
    branch="$(git -C "$repo" rev-parse --abbrev-ref HEAD)"
    sha="$(git -C "$repo" rev-parse --short HEAD)"
    if [[ "$branch" == HEAD ]]; then
        branch="$sha" # detached HEAD
    fi
    dirty=false
    if [[ -n "$(git -C "$repo" status --porcelain)" ]]; then
        dirty=true
    fi
fi
branch_meta="$(printf %s "$branch" | tr -c '0-9A-Za-z.-' -)"
version="${upstream_version}+${build_type}${branch_meta}-${build_number}"
tag="v${version}"
tarball="tabby-tmux-${version}.tgz"

if [[ "$cmd" == version ]]; then
    echo "$version"
    exit 0
fi

# ------------------------------------------------------------------ build ----
if [[ "$do_build" == true ]]; then
    (cd "$repo" && pnpm run build)
fi
if [[ ! -f "$repo/dist/index.js" ]]; then
    echo "dist/index.js not found; run without --no-build" >&2
    exit 1
fi

rm -rf "$out"
mkdir -p "$stage/dist"
cp "$repo"/dist/* "$stage/dist/"

built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
node - "$repo/package.json" "$stage/package.json" "$version" "$branch" "$sha" "$dirty" "$built_at" <<'NODE'
const fs = require('fs')
const [src, dst, version, branch, sha, dirty, builtAt] = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync(src, 'utf8'))
pkg.version = version
pkg.buildInfo = {
    branch,
    sha,
    dirty: dirty === 'true',
    builtAt,
    ci: Boolean(process.env.GITLAB_CI),
    pipeline: process.env.CI_PIPELINE_URL || undefined,
}
fs.writeFileSync(dst, JSON.stringify(pkg, null, 4) + '\n')
NODE

# Tarball with a single "tabby-tmux/" root: extract it straight into
# <tabby user data>/plugins/node_modules/, or `npm install <file>` also works.
tar -czf "$out/$tarball" -C "$out" tabby-tmux

# Consumed by the GitLab release job (artifacts:reports:dotenv).
cat > "$out/build.env" <<EOF
PLUGIN_VERSION=$version
PLUGIN_TAG=$tag
PLUGIN_TARBALL=$tarball
EOF

echo "Built tabby-tmux $version (branch $branch, commit $sha$([[ "$dirty" == true ]] && echo ', dirty'))"
echo "  $stage"
echo "  $out/$tarball"

# ----------------------------------------------------------------- deploy ----
if [[ "$do_deploy" != true ]]; then
    exit 0
fi

if [[ -n "${TABBY_USER_DATA:-}" ]]; then
    user_data="$TABBY_USER_DATA"
else
    case "$(uname -s)" in
        MINGW* | MSYS* | CYGWIN*) user_data="$(cygpath -u "$APPDATA")/tabby" ;;
        Darwin) user_data="$HOME/Library/Application Support/tabby" ;;
        *) user_data="${XDG_CONFIG_HOME:-$HOME/.config}/tabby" ;;
    esac
fi
target="$user_data/plugins/node_modules/tabby-tmux"

# Keep one copy of whatever npm installed, so you can roll back by hand.
if [[ -d "$target/dist" && ! -d "$target/dist.npm-backup" ]]; then
    cp -r "$target/dist" "$target/dist.npm-backup"
    echo "Backed up original dist/ to $target/dist.npm-backup"
fi

mkdir -p "$target/dist"
cp "$stage"/dist/* "$target/dist/"
cp "$stage/package.json" "$target/package.json"

echo "Installed tabby-tmux $version to $target"
echo "Restart Tabby to load it (plugins are only loaded at startup)."
