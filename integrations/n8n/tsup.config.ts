import { cpSync } from 'node:fs'
import { defineConfig } from 'tsup'

// n8n loads community nodes with require(), so the output is CommonJS. The
// SDK is bundled in (a verified n8n node may not have runtime dependencies);
// n8n-workflow is provided by n8n itself and stays external.
export default defineConfig({
  entry: [
    'credentials/SteelApi.credentials.ts',
    'nodes/Steel/Steel.node.ts',
    'nodes/SteelTrigger/SteelTrigger.node.ts',
  ],
  format: ['cjs'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  splitting: false,
  external: ['n8n-workflow'],
  noExternal: ['@steel-so/sdk', 'openapi-fetch'],
  async onSuccess() {
    cpSync('nodes/Steel/steel.svg', 'dist/nodes/Steel/steel.svg')
    cpSync('nodes/Steel/steel.svg', 'dist/nodes/SteelTrigger/steel.svg')
    cpSync('nodes/Steel/steel.svg', 'dist/credentials/steel.svg')
  },
})
