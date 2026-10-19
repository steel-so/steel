'use strict'

/**
 * Cross-replica tag invalidation for the `'use cache'` handler (ADR 0038).
 *
 * Every app replica keeps its own in-memory cache (Next's default LRU, wrapped
 * here), but the *tag* state — when `site:<slug>` was last revalidated — is
 * shared through Redis:
 *
 * - `updateTags` (what `revalidateTag()` calls) applies the change locally,
 *   then max-merges it into two Redis hashes and bumps a version counter.
 * - `refreshTags` (called by Next before a request reads the cache) reads the
 *   counter; only when it moved does it pull the hashes and max-merge them
 *   into the local manifest. One `GET` per request that touches the cache,
 *   concurrent callers share it.
 *
 * The local manifest is the Map Next's default handler and its incremental
 * cache already read (`tags-manifest.external`), so an entry rendered on
 * replica A before a publish on replica B is treated as expired on A as soon
 * as A refreshes.
 *
 * Redis is never in the critical path: every call has a short timeout, and a
 * failure (Redis down, not connected yet, build time without Redis) only logs
 * and leaves the replica on its last known tag state.
 *
 * Plain CommonJS on purpose: Next loads `cacheHandlers` files at runtime with
 * a dynamic import, without bundling, so this file cannot use the `@/` alias,
 * TypeScript or the Zod env module (hence the direct `process.env` reads in
 * `handler.cjs`, the documented exception for runtime-loaded files).
 */

const DEFAULT_KEY_PREFIX = 'steel:next-cache'
const DEFAULT_TIMEOUT_MS = 150
/**
 * How far ahead of this process' clock a remote `expired` timestamp may be
 * and still count as "now". Next only treats a tag as expired once
 * `expired <= now` on the replica reading it, and the writer's timestamp is
 * rounded up to the millisecond and comes from another process' clock
 * (`performance.timeOrigin` differs per process, hosts drift): without the
 * clamp a publish on one replica would take effect on the others only after
 * their clock caught up. A deliberate future expiration (`revalidateTag` with
 * `expire > 0`) shorter than this applies slightly early, which is harmless.
 */
const CLOCK_SKEW_MS = 2000
const LOG_EVERY_MS = 60_000
const BUILD_PHASE = 'phase-production-build'

/**
 * Max-merges `stale`/`expired` per tag in Redis, so two replicas revalidating
 * the same tag at once can never move it back in time.
 * KEYS: stale hash, expired hash, version counter.
 * ARGV: tag, stale, expired (repeated; -1 = field absent).
 */
const MERGE_SCRIPT = `
for i = 1, #ARGV, 3 do
  local tag = ARGV[i]
  local stale = tonumber(ARGV[i + 1])
  local expired = tonumber(ARGV[i + 2])
  if stale >= 0 then
    local current = tonumber(redis.call('HGET', KEYS[1], tag) or '-1')
    if stale > current then redis.call('HSET', KEYS[1], tag, ARGV[i + 1]) end
  end
  if expired >= 0 then
    local current = tonumber(redis.call('HGET', KEYS[2], tag) or '-1')
    if expired > current then redis.call('HSET', KEYS[2], tag, ARGV[i + 2]) end
  end
end
return redis.call('INCR', KEYS[3])
`

/**
 * @typedef {{ stale?: number, expired?: number }} TagEntry
 * @typedef {Map<string, TagEntry>} TagsManifest
 * @typedef {{
 *   get(cacheKey: string, softTags: string[]): Promise<any>,
 *   set(cacheKey: string, pendingEntry: Promise<any>): Promise<void>,
 *   refreshTags(): Promise<void>,
 *   getExpiration(tags: string[]): Promise<number>,
 *   updateTags(tags: string[], durations?: { expire?: number }): Promise<void>,
 * }} CacheHandler
 * @typedef {{
 *   get(key: string): Promise<string | null>,
 *   eval(script: string, options: { keys: string[], arguments: string[] }): Promise<unknown>,
 *   multi(): { hGetAll(key: string): any, exec(): Promise<unknown[]> },
 * }} TagsRedis
 * @typedef {(event: string, error: unknown) => void} TagsLogger
 */

/** @param {unknown} value */
function isTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Field-wise max of two tag entries (a missing field never wins).
 * @param {TagEntry | undefined} current
 * @param {TagEntry} incoming
 * @returns {TagEntry}
 */
function mergeTagEntry(current, incoming) {
  /** @type {TagEntry} */
  const merged = { ...(current ?? {}) }
  for (const field of /** @type {const} */ (['stale', 'expired'])) {
    const value = incoming[field]
    if (!isTimestamp(value)) continue
    const existing = merged[field]
    if (existing === undefined || /** @type {number} */ (value) > existing) {
      merged[field] = value
    }
  }
  return merged
}

/**
 * Races `promise` against a timer that never keeps the process alive.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${ms}ms`)),
      ms,
    )
    timer.unref?.()
  })
  return /** @type {Promise<T>} */ (
    Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
  )
}

/**
 * Logs one structured line per event at most once a minute, so a Redis
 * outage does not flood the app log with a warning per request.
 * @param {(line: string) => void} write
 * @param {() => number} now
 * @returns {TagsLogger}
 */
function createThrottledLogger(write, now = Date.now) {
  /** @type {Map<string, number>} */
  const lastLogged = new Map()
  return (event, error) => {
    const at = now()
    const last = lastLogged.get(event)
    if (last !== undefined && at - last < LOG_EVERY_MS) return
    lastLogged.set(event, at)
    write(
      JSON.stringify({
        level: 'warn',
        message: event,
        component: 'NextCacheHandler',
        cause: error instanceof Error ? error.message : String(error),
      }),
    )
  }
}

/**
 * Wraps a cache handler with tag state shared through Redis.
 * @param {{
 *   base: CacheHandler,
 *   manifest: TagsManifest,
 *   getRedis: () => TagsRedis | null,
 *   log: TagsLogger,
 *   timeoutMs?: number,
 *   keyPrefix?: string,
 *   now?: () => number,
 * }} options
 * @returns {CacheHandler}
 */
function createSharedTagsCacheHandler({
  base,
  manifest,
  getRedis,
  log,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  keyPrefix = DEFAULT_KEY_PREFIX,
  now = () => performance.timeOrigin + performance.now(),
}) {
  const staleKey = `${keyPrefix}:tags:stale`
  const expiredKey = `${keyPrefix}:tags:expired`
  const versionKey = `${keyPrefix}:tags:version`

  /** Version of the Redis tag state already merged here (null = never). */
  /** @type {string | null | undefined} */
  let knownVersion
  /** @type {Promise<void> | null} */
  let inFlight = null

  /**
   * @param {Record<string, string> | null | undefined} hash
   * @param {'stale' | 'expired'} field
   */
  function mergeHash(hash, field) {
    for (const [tag, raw] of Object.entries(hash ?? {})) {
      let value = Number(raw)
      if (!isTimestamp(value)) continue
      if (field === 'expired') {
        const localNow = now()
        if (value > localNow && value - localNow <= CLOCK_SKEW_MS) {
          value = localNow
        }
      }
      manifest.set(tag, mergeTagEntry(manifest.get(tag), { [field]: value }))
    }
  }

  async function pull() {
    const redis = getRedis()
    if (!redis) return
    try {
      const version = await withTimeout(redis.get(versionKey), timeoutMs)
      if (version === knownVersion) return
      const [stale, expired] = await withTimeout(
        redis.multi().hGetAll(staleKey).hGetAll(expiredKey).exec(),
        timeoutMs,
      )
      mergeHash(/** @type {Record<string, string>} */ (stale), 'stale')
      mergeHash(/** @type {Record<string, string>} */ (expired), 'expired')
      knownVersion = version
    } catch (error) {
      log('next_cache.tags_refresh_failed', error)
    }
  }

  return {
    get: (cacheKey, softTags) => base.get(cacheKey, softTags),
    set: (cacheKey, pendingEntry) => base.set(cacheKey, pendingEntry),
    getExpiration: (tags) => base.getExpiration(tags),

    async refreshTags() {
      await base.refreshTags()
      if (!inFlight) {
        inFlight = pull().finally(() => {
          inFlight = null
        })
      }
      await inFlight
    },

    async updateTags(tags, durations) {
      await base.updateTags(tags, durations)
      if (tags.length === 0) return
      const redis = getRedis()
      if (!redis) return
      /** @type {string[]} */
      const args = []
      for (const tag of tags) {
        const entry = manifest.get(tag) ?? {}
        args.push(
          tag,
          String(isTimestamp(entry.stale) ? entry.stale : -1),
          String(isTimestamp(entry.expired) ? entry.expired : -1),
        )
      }
      try {
        await withTimeout(
          redis.eval(MERGE_SCRIPT, {
            keys: [staleKey, expiredKey, versionKey],
            arguments: args,
          }),
          timeoutMs,
        )
      } catch (error) {
        log('next_cache.tags_publish_failed', error)
      }
    },
  }
}

/**
 * Lazily connected Redis client for the handler. Returns null until the
 * client is ready (commands never queue while offline), during `next build`
 * (no Redis there) and without `REDIS_URL`.
 * @param {Record<string, string | undefined>} env
 * @param {{
 *   createClient: (options: any) => any,
 *   readFile: (path: string) => Buffer | string,
 *   log: TagsLogger,
 * }} deps
 * @returns {() => TagsRedis | null}
 */
function createRedisGetter(env, { createClient, readFile, log }) {
  if (!env.REDIS_URL || env.NEXT_PHASE === BUILD_PHASE) return () => null

  /** @type {any} */
  let client = null
  return () => {
    if (!client) {
      const tls = env.REDIS_TLS_ENABLED === 'true'
      client = createClient({
        url: env.REDIS_URL,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: 5000,
          // Never give up: the handler lives as long as the process.
          reconnectStrategy: (/** @type {number} */ retries) =>
            Math.min(retries * 200, 5000),
          ...(tls
            ? {
                tls: true,
                ca: env.REDIS_TLS_CA_PATH
                  ? readFile(env.REDIS_TLS_CA_PATH)
                  : undefined,
              }
            : {}),
        },
      })
      client.on('error', (/** @type {unknown} */ error) =>
        log('next_cache.redis_error', error),
      )
      client
        .connect()
        .catch((/** @type {unknown} */ error) =>
          log('next_cache.redis_connect_failed', error),
        )
    }
    return client.isReady ? client : null
  }
}

/**
 * The handler Next loads (`next.config.ts` → `cacheHandlers.default`).
 * @param {Record<string, string | undefined>} env
 * @param {{
 *   createDefaultCacheHandler: (maxSize: number) => CacheHandler,
 *   tagsManifest: TagsManifest,
 *   createClient: (options: any) => any,
 *   readFile: (path: string) => Buffer | string,
 *   write: (line: string) => void,
 * }} deps
 * @returns {CacheHandler}
 */
function createHandlerFromEnv(env, deps) {
  const log = createThrottledLogger(deps.write)
  const timeout = Number(env.NEXT_CACHE_TAGS_TIMEOUT_MS)
  return createSharedTagsCacheHandler({
    // Same 50 MB in-memory LRU Next uses when no handler is configured.
    base: deps.createDefaultCacheHandler(50 * 1024 * 1024),
    manifest: deps.tagsManifest,
    getRedis: createRedisGetter(env, {
      createClient: deps.createClient,
      readFile: deps.readFile,
      log,
    }),
    log,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
  })
}

module.exports = {
  CLOCK_SKEW_MS,
  MERGE_SCRIPT,
  mergeTagEntry,
  withTimeout,
  createThrottledLogger,
  createSharedTagsCacheHandler,
  createRedisGetter,
  createHandlerFromEnv,
}
