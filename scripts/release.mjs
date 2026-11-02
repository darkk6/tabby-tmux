#!/usr/bin/env node
// GitLab CI release step. Runs after scripts/build.sh in the same pipeline and
// needs only the job token (no personal access token):
//   1. fail if this version was already released / tagged (bump BUILD_NUMBER first)
//   2. upload out/<tarball> to the project's generic package registry
//   3. create the tag + release, with the package as a downloadable asset
//
// Inputs: PLUGIN_VERSION / PLUGIN_TAG / PLUGIN_TARBALL from out/build.env (dotenv
// artifact of the build job) plus the usual CI_* variables.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const env = (name) => {
    const value = process.env[name]
    if (!value) {
        console.error(`missing environment variable ${name}`)
        process.exit(1)
    }
    return value
}

const api = env('CI_API_V4_URL')
const projectId = env('CI_PROJECT_ID')
const jobToken = env('CI_JOB_TOKEN')
const sha = env('CI_COMMIT_SHA')
const ref = env('CI_COMMIT_REF_NAME')
const version = env('PLUGIN_VERSION')
const tag = env('PLUGIN_TAG')
const tarball = env('PLUGIN_TARBALL')
const projectUrl = env('CI_PROJECT_URL')
const pipelineUrl = env('CI_PIPELINE_URL')

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tarballPath = path.join(repo, 'out', tarball)
if (!fs.existsSync(tarballPath)) {
    console.error(`${tarballPath} not found; the build job must run first`)
    process.exit(1)
}

const packageName = 'tabby-tmux'
const projectApi = `${api}/projects/${projectId}`
const packageUrl =
    `${projectApi}/packages/generic/${packageName}/` +
    `${encodeURIComponent(version)}/${encodeURIComponent(tarball)}`

const request = async (method, url, { body, headers = {} } = {}) => {
    const res = await fetch(url, {
        method,
        headers: { 'JOB-TOKEN': jobToken, ...headers },
        body,
    })
    const text = await res.text()
    return { status: res.status, text }
}

// 1. the version must not be released yet.
// The job token cannot read the Tags API (GitLab 17.11 only allows Releases and
// Packages here), so check the release first; a bare tag left over from
// elsewhere is caught after creation in step 3.
const releaseUrl = `${projectApi}/releases/${encodeURIComponent(tag)}`
{
    const { status, text } = await request('GET', releaseUrl)
    if (status === 200) {
        console.error(
            `release ${tag} already exists: bump BUILD_NUMBER and commit before releasing`,
        )
        process.exit(1)
    }
    if (status !== 404) {
        console.error(`checking release ${tag} failed: HTTP ${status}\n${text}`)
        process.exit(1)
    }
    console.log(`${tag} is not released yet`)
}

// 2. upload the tarball
{
    const { status, text } = await request('PUT', `${packageUrl}?select=package_file`, {
        body: fs.readFileSync(tarballPath),
        headers: { 'Content-Type': 'application/octet-stream' },
    })
    if (status !== 200 && status !== 201) {
        console.error(`uploading ${tarball} failed: HTTP ${status}\n${text}`)
        process.exit(1)
    }
    console.log(`uploaded ${packageUrl}`)
}

// 3. create tag + release
{
    const description = [
        `Build of branch \`${ref}\` at ${sha} ([pipeline](${pipelineUrl})).`,
        '',
        '## Install',
        '',
        `1. Download \`${tarball}\` below.`,
        '2. Quit Tabby.',
        "3. Extract it into Tabby's plugin folder so that it becomes `plugins/node_modules/tabby-tmux/`:",
        '    - Windows: `%APPDATA%\\tabby\\plugins\\node_modules\\`',
        '    - macOS: `~/Library/Application Support/tabby/plugins/node_modules/`',
        '    - Linux: `~/.config/tabby/plugins/node_modules/`',
        '',
        `   e.g. \`tar -xzf ${tarball} -C "<that folder>"\` (replaces the existing \`tabby-tmux/\`).`,
        '4. Start Tabby.',
        '',
        `Package registry: ${projectUrl}/-/packages`,
    ].join('\n')

    const { status, text } = await request('POST', `${projectApi}/releases`, {
        body: JSON.stringify({
            tag_name: tag,
            ref: sha,
            name: tag,
            description,
            assets: {
                links: [
                    {
                        name: tarball,
                        url: packageUrl,
                        link_type: 'package',
                    },
                ],
            },
        }),
        headers: { 'Content-Type': 'application/json' },
    })
    if (status !== 201) {
        console.error(`creating release ${tag} failed: HTTP ${status}\n${text}`)
        process.exit(1)
    }
    const release = JSON.parse(text)
    // `ref` is only used when the tag does not exist. If a tag of that name was
    // already there (pointing elsewhere) the release landed on it: undo that.
    if (release.commit?.id && release.commit.id !== sha) {
        await request('DELETE', releaseUrl)
        console.error(
            `tag ${tag} already existed at ${release.commit.id}, not ${sha}; ` +
                'release removed again. Bump BUILD_NUMBER and commit before releasing.',
        )
        process.exit(1)
    }
    console.log(`released ${tag}: ${release._links?.self ?? `${projectUrl}/-/releases/${tag}`}`)
}
