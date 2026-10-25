---
name: release
description: Prepare a tabby-tmux version release by checking changes, updating version and changelog, and validating the build. Use when asked to prepare or publish a release for this repository.
---

# tabby-tmux Release

Prepare a reviewable release for this repository. Read the repository `AGENTS.md`, `package.json`, `CHANGELOG.md`, and `.github/workflows/publish.yml` first. Use the actual git tags and commit history to establish the previous release and summarize user-visible changes; do not infer release contents from uncommitted or unrelated changes.

## Prepare the release

- Check `git status` before editing. Preserve existing user changes and include them only when the user identifies them as part of this release.
- Determine the next version from the requested version, current `package.json`, latest tag, and change scope. Follow SemVer; flag a version/tag mismatch instead of silently choosing one.
- Update `package.json`'s version and add a concise, user-facing entry to `CHANGELOG.md` in the repository's existing language and style. Include only changes since the previous release that belong to this release. Keep the changelog newest-first and use the release date only when known.
- Run the checks required by `AGENTS.md` and the project CI that are relevant to a release: lint, typecheck, format check, tests (including integration and performance checks when their dependencies are available), and build. Report checks that cannot run and why.
- Review the final diff, version, changelog, and working tree. Summarize the release contents and verification results for the user.

## Publish

Pushing a `v*` tag triggers `.github/workflows/publish.yml`, which builds and publishes the package to npm and creates a GitHub Release. Treat tag pushes, publishing, and GitHub release creation as external release actions: prepare all files and checks first, then get the user's explicit go-ahead before performing them unless that exact action was already explicitly requested.

The workflow_dispatch `version` input currently does not update `package.json`; verify the package version and tag agree before publishing. The workflow writes generated commit notes to `CHANGELOG.md` in its CI checkout for the GitHub Release body. Maintain the tracked `CHANGELOG.md` as the project's version history; do not replace it with generated release notes.
