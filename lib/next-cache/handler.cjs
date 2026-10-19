'use strict'

/**
 * `'use cache'` handler of the app (next.config.ts → `cacheHandlers.default`):
 * Next's own in-memory LRU, with tag invalidation shared between replicas
 * through Redis. See `shared-tags.cjs` and ADR 0038.
 *
 * Loaded by Next at runtime without bundling, so it reads `process.env`
 * directly (the Zod env module is TypeScript behind the `@/` alias). The two
 * `next/dist` modules are the ones Next itself uses for the default handler;
 * `tags-manifest.external` is a single module per process, shared with the
 * incremental cache.
 */

const { readFileSync } = require('node:fs')
const { createClient } = require('redis')
const {
  createDefaultCacheHandler,
} = require('next/dist/server/lib/cache-handlers/default')
const {
  tagsManifest,
} = require('next/dist/server/lib/incremental-cache/tags-manifest.external')
const { createHandlerFromEnv } = require('./shared-tags.cjs')

module.exports = createHandlerFromEnv(process.env, {
  createDefaultCacheHandler,
  tagsManifest,
  createClient,
  readFile: readFileSync,
  write: (line) => console.warn(line),
})
