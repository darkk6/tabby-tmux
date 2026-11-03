import { createRequire } from 'module'
import { join } from 'path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { baseDestroy } = vi.hoisted(() => ({ baseDestroy: vi.fn() }))

vi.mock('tabby-core', () => ({
    ConfigService: class {},
    LogService: class {},
    TabContextMenuItemProvider: class {},
}))
vi.mock('tabby-terminal', () => ({
    BaseTerminalTabComponent: class {
        static template = ''
        static styles = []
        static animations = []
        async destroy(): Promise<void> {
            baseDestroy()
        }
    },
    TerminalContextMenuItemProvider: class {},
}))
vi.mock('../session', () => ({ TmuxController: class {}, TmuxPaneSession: class {} }))
vi.mock('../services/tmux.service', () => ({ TmuxService: class {} }))
vi.mock('../services/tmuxI18n.service', () => ({ TmuxI18nService: class {} }))
vi.mock('./tmuxSessionTab.component', () => ({ TmuxSessionTabComponent: class {} }))

let Pane: typeof import('./tmuxPaneTab.component').TmuxPaneTabComponent

beforeAll(async () => {
    const require = createRequire(join(process.cwd(), 'package.json'))
    const previous = require.extensions['.scss']
    require.extensions['.scss'] = (module) => {
        module.exports = ''
    }
    try {
        Pane = (await import('./tmuxPaneTab.component')).TmuxPaneTabComponent
    } finally {
        if (previous) require.extensions['.scss'] = previous
        else delete require.extensions['.scss']
    }
})

beforeEach(() => {
    baseDestroy.mockClear()
})

function createPane(
    options: { parent?: { isTearingDown?: boolean } | null; tracked?: boolean } = {},
) {
    const controller = {
        isPaneTracked: vi.fn(() => options.tracked ?? true),
        killPane: vi.fn().mockResolvedValue(undefined),
    }
    const pane = Object.assign(Object.create(Pane.prototype), {
        paneId: 7,
        controller,
        parent: options.parent === undefined ? { isTearingDown: false } : options.parent,
    }) as InstanceType<typeof Pane>
    return { pane, controller }
}

describe('tmux pane close', () => {
    it('turns a Tabby close request (close-pane hotkey) into kill-pane', async () => {
        const { pane, controller } = createPane()
        await pane.destroy()
        expect(controller.killPane).toHaveBeenCalledWith(7)
        // The local view stays until tmux reports the pane closed.
        expect(baseDestroy).not.toHaveBeenCalled()
    })

    it('only cleans up locally on the plugin teardown path', async () => {
        const { pane, controller } = createPane()
        await pane.destroyLocal()
        expect(baseDestroy).toHaveBeenCalledTimes(1)
        expect(controller.killPane).not.toHaveBeenCalled()

        // A later destroy() on the same pane must not kill it either.
        await pane.destroy()
        expect(controller.killPane).not.toHaveBeenCalled()
    })

    it.each([
        ['the session tab is tearing down', { parent: { isTearingDown: true } }],
        ['the pane is detached', { parent: null }],
        ['tmux no longer tracks the pane', { tracked: false }],
    ])('destroys locally when %s', async (_name, options) => {
        const { pane, controller } = createPane(options)
        await pane.destroy()
        expect(baseDestroy).toHaveBeenCalledTimes(1)
        expect(controller.killPane).not.toHaveBeenCalled()
    })
})
