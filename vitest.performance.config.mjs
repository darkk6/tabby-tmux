import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/paneSnapshot.performance.spec.ts'],
        env: { TMUX_TEST_BINARY: process.env.TMUX_TEST_BINARY ?? 'tmux' },
        silent: false,
    },
})
