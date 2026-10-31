import { defineConfig } from 'vitest/config'

// Only the pure logic in src/lib is unit-tested and gated by coverage. The
// entry points (background, content scripts, side panel) are thin wiring over
// the chrome.* APIs and are verified by loading the unpacked build in a browser.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/types.ts', 'src/lib/chrome-stores.ts'],
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
})
