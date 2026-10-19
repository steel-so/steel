import { createDefaultCacheHandler } from 'next/dist/server/lib/cache-handlers/default'
import { tagsManifest } from 'next/dist/server/lib/incremental-cache/tags-manifest.external'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createHandlerFromEnv,
  createRedisGetter,
  createSharedTagsCacheHandler,
  createThrottledLogger,
  MERGE_SCRIPT,
  mergeTagEntry,
  withTimeout,
} from '../next-cache/shared-tags.cjs'

type TagEntry = { stale?: number; expired?: number }

const PREFIX = 'test:next-cache'
const STALE_KEY = `${PREFIX}:tags:stale`
const EXPIRED_KEY = `${PREFIX}:tags:expired`
const VERSION_KEY = `${PREFIX}:tags:version`

/** In-memory stand-in for the three Redis keys; `eval` mirrors the Lua
 * script (the real script runs in the integration test). */
function createFakeRedis() {
  const hashes = new Map<string, Map<string, string>>([
    [STALE_KEY, new Map()],
    [EXPIRED_KEY, new Map()],
  ])
  let version: number | null = null
  const calls = { get: 0, multi: 0, eval: 0 }

  const redis = {
    calls,
    hashes,
    get: vi.fn(async (key: string) => {
      calls.get += 1
      return key === VERSION_KEY && version !== null ? String(version) : null
    }),
    eval: vi.fn(
      async (
        _script: string,
        { keys, arguments: args }: { keys: string[]; arguments: string[] },
      ) => {
        calls.eval += 1
        for (let i = 0; i < args.length; i += 3) {
          const [tag, stale, expired] = args.slice(i, i + 3)
          for (const [key, raw] of [
            [keys[0], stale],
            [keys[1], expired],
          ] as const) {
            const value = Number(raw)
            if (value < 0) continue
            const hash = hashes.get(key) as Map<string, string>
            const current = Number(hash.get(tag) ?? -1)
            if (value > current) hash.set(tag, raw)
          }
        }
        version = (version ?? 0) + 1
        return version
      },
    ),
    multi: vi.fn(() => {
      calls.multi += 1
      const reads: string[] = []
      const chain = {
        hGetAll(key: string) {
          reads.push(key)
          return chain
        },
        exec: async () =>
          reads.map((key) => Object.fromEntries(hashes.get(key) ?? [])),
      }
      return chain
    }),
    /** Simulates another replica's write without going through a handler. */
    seed(field: 'stale' | 'expired', tag: string, value: number | string) {
      const key = field === 'stale' ? STALE_KEY : EXPIRED_KEY
      hashes.get(key)?.set(tag, String(value))
      version = (version ?? 0) + 1
    },
  }
  return redis
}

function createFakeBase(manifest: Map<string, TagEntry>) {
  return {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
    refreshTags: vi.fn(async () => undefined),
    getExpiration: vi.fn(async () => 42),
    updateTags: vi.fn(async (tags: string[]) => {
      for (const tag of tags) {
        manifest.set(tag, { ...manifest.get(tag), stale: 1000, expired: 1000 })
      }
    }),
  }
}

function setup(
  opts: {
    redis?: ReturnType<typeof createFakeRedis> | null
    timeoutMs?: number
  } = {},
) {
  const manifest = new Map<string, TagEntry>()
  const base = createFakeBase(manifest)
  const redis = opts.redis === undefined ? createFakeRedis() : opts.redis
  const log = vi.fn()
  const handler = createSharedTagsCacheHandler({
    base,
    manifest,
    getRedis: () => redis as never,
    log,
    timeoutMs: opts.timeoutMs,
    keyPrefix: PREFIX,
  })
  return { manifest, base, redis, log, handler }
}

describe('mergeTagEntry', () => {
  it('keeps the newest value of each field', () => {
    expect(
      mergeTagEntry({ stale: 10, expired: 50 }, { stale: 20, expired: 40 }),
    ).toEqual({ stale: 20, expired: 50 })
  })

  it('starts from nothing and ignores missing or invalid fields', () => {
    expect(mergeTagEntry(undefined, { expired: 7 })).toEqual({ expired: 7 })
    expect(
      mergeTagEntry({ stale: 3 }, { stale: Number.NaN, expired: -1 }),
    ).toEqual({ stale: 3 })
  })
})

describe('withTimeout', () => {
  it('resolves with the promise when it settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok')
  })

  it('rejects when the promise takes longer than the budget', async () => {
    await expect(
      withTimeout(new Promise(() => undefined), 5),
    ).rejects.toThrow('timed out after 5ms')
  })
})

describe('createThrottledLogger', () => {
  it('writes one structured line per event per minute', () => {
    const write = vi.fn()
    let now = 0
    const log = createThrottledLogger(write, () => now)

    log('next_cache.redis_error', new Error('ECONNREFUSED'))
    log('next_cache.redis_error', new Error('again'))
    log('next_cache.tags_refresh_failed', 'plain string')
    now = 60_000
    log('next_cache.redis_error', new Error('later'))

    expect(write).toHaveBeenCalledTimes(3)
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({
      level: 'warn',
      message: 'next_cache.redis_error',
      component: 'NextCacheHandler',
      cause: 'ECONNREFUSED',
    })
    expect(JSON.parse(write.mock.calls[1][0]).cause).toBe('plain string')
    expect(JSON.parse(write.mock.calls[2][0]).cause).toBe('later')
  })

  it('defaults to the wall clock', () => {
    const write = vi.fn()
    createThrottledLogger(write)('event', new Error('x'))
    expect(write).toHaveBeenCalledTimes(1)
  })
})

describe('createSharedTagsCacheHandler', () => {
  it('delegates reads and writes of entries to the base handler', async () => {
    const { handler, base } = setup()
    const pending = Promise.resolve({} as never)

    await handler.get('key', ['_N_T_/layout'])
    await handler.set('key', pending)

    expect(base.get).toHaveBeenCalledWith('key', ['_N_T_/layout'])
    expect(base.set).toHaveBeenCalledWith('key', pending)
    await expect(handler.getExpiration(['site:a'])).resolves.toBe(42)
  })

  it('applies a revalidation locally and publishes it to Redis', async () => {
    const { handler, base, redis } = setup()

    await handler.updateTags(['site:a', 'site:b'], { expire: 0 })

    expect(base.updateTags).toHaveBeenCalledWith(['site:a', 'site:b'], {
      expire: 0,
    })
    expect(redis?.eval).toHaveBeenCalledWith(MERGE_SCRIPT, {
      keys: [STALE_KEY, EXPIRED_KEY, VERSION_KEY],
      arguments: ['site:a', '1000', '1000', 'site:b', '1000', '1000'],
    })
    expect(redis?.hashes.get(EXPIRED_KEY)?.get('site:a')).toBe('1000')
  })

  it('publishes -1 for fields the local manifest does not have', async () => {
    const manifest = new Map<string, TagEntry>()
    const redis = createFakeRedis()
    const handler = createSharedTagsCacheHandler({
      base: {
        ...createFakeBase(manifest),
        updateTags: vi.fn(async (tags: string[]) => {
          manifest.set(tags[0], { expired: 5 })
        }),
      },
      manifest,
      getRedis: () => redis as never,
      log: vi.fn(),
      keyPrefix: PREFIX,
    })

    await handler.updateTags(['site:a', 'site:never'])

    expect(redis.eval.mock.calls[0][1].arguments).toEqual([
      'site:a',
      '-1',
      '5',
      'site:never',
      '-1',
      '-1',
    ])
  })

  it('skips Redis for an empty tag list or when Redis is not ready', async () => {
    const ready = setup()
    await ready.handler.updateTags([])
    expect(ready.redis?.eval).not.toHaveBeenCalled()

    const offline = setup({ redis: null })
    await offline.handler.updateTags(['site:a'])
    await offline.handler.refreshTags()
    expect(offline.base.updateTags).toHaveBeenCalled()
    expect(offline.manifest.get('site:a')).toEqual({
      stale: 1000,
      expired: 1000,
    })
    expect(offline.log).not.toHaveBeenCalled()
  })

  it('logs instead of throwing when publishing fails', async () => {
    const redis = createFakeRedis()
    redis.eval.mockRejectedValueOnce(new Error('READONLY'))
    const { handler, log } = setup({ redis })

    await expect(handler.updateTags(['site:a'])).resolves.toBeUndefined()

    expect(log).toHaveBeenCalledWith(
      'next_cache.tags_publish_failed',
      expect.any(Error),
    )
  })

  it('merges what other replicas published into the local manifest', async () => {
    const { handler, manifest, redis, base } = setup()
    manifest.set('site:a', { stale: 900, expired: 2000 })
    redis?.seed('stale', 'site:a', 1500)
    redis?.seed('expired', 'site:a', 1200)
    redis?.seed('expired', 'site:b', 3000)
    redis?.seed('stale', 'site:bad', 'not-a-number')

    await handler.refreshTags()

    expect(base.refreshTags).toHaveBeenCalled()
    expect(manifest.get('site:a')).toEqual({ stale: 1500, expired: 2000 })
    expect(manifest.get('site:b')).toEqual({ expired: 3000 })
    expect(manifest.has('site:bad')).toBe(false)
  })

  it('pulls the hashes only when the version moved', async () => {
    const { handler, redis } = setup()

    await handler.refreshTags() // never synced: pulls once (empty state)
    await handler.refreshTags() // same version: one GET, no pull
    expect(redis?.calls).toMatchObject({ get: 2, multi: 1 })

    redis?.seed('expired', 'site:a', 10)
    await handler.refreshTags()
    expect(redis?.calls).toMatchObject({ get: 3, multi: 2 })
  })

  it('tolerates an empty transaction reply', async () => {
    const redis = createFakeRedis()
    redis.multi.mockReturnValueOnce({
      hGetAll() {
        return this
      },
      exec: async () => [null, undefined],
    } as never)
    const { handler, log, manifest } = setup({ redis })

    await handler.refreshTags()

    expect(manifest.size).toBe(0)
    expect(log).not.toHaveBeenCalled()
  })

  it('shares one Redis round trip between concurrent refreshes', async () => {
    const { handler, redis } = setup()

    await Promise.all([
      handler.refreshTags(),
      handler.refreshTags(),
      handler.refreshTags(),
    ])

    expect(redis?.calls.get).toBe(1)
  })

  it('keeps the last known state when Redis is slow or failing', async () => {
    const redis = createFakeRedis()
    redis.get.mockImplementationOnce(() => new Promise(() => undefined))
    const { handler, log } = setup({ redis, timeoutMs: 5 })

    await expect(handler.refreshTags()).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith(
      'next_cache.tags_refresh_failed',
      expect.any(Error),
    )

    // Next attempt goes to Redis again (the failed one did not count).
    await handler.refreshTags()
    expect(redis.calls.multi).toBe(1)
  })
})

describe('with the real Next default handler', () => {
  afterEach(() => {
    tagsManifest.clear()
  })

  function entry(tags: string[]) {
    return {
      value: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('payload'))
          controller.close()
        },
      }),
      tags,
      stale: 300,
      timestamp: Math.round(performance.timeOrigin + performance.now()) - 10,
      expire: 86_400,
      revalidate: 3600,
    }
  }

  it('drops an entry on this replica once another replica revalidated its tag', async () => {
    const redis = createFakeRedis()
    const replicaA = createSharedTagsCacheHandler({
      base: createDefaultCacheHandler(1024 * 1024),
      manifest: tagsManifest,
      getRedis: () => redis as never,
      log: vi.fn(),
      keyPrefix: PREFIX,
    })
    // Replica B: its own process, so its own manifest.
    const manifestB = new Map<string, TagEntry>()
    const replicaB = createSharedTagsCacheHandler({
      base: {
        ...createFakeBase(manifestB),
        updateTags: vi.fn(async (tags: string[]) => {
          const now = Math.round(performance.timeOrigin + performance.now())
          for (const tag of tags) manifestB.set(tag, { stale: now, expired: now })
        }),
      },
      manifest: manifestB,
      getRedis: () => redis as never,
      log: vi.fn(),
      keyPrefix: PREFIX,
    })

    await replicaA.set('site-key', Promise.resolve(entry(['site:acme'])))
    await replicaA.refreshTags()
    expect(await replicaA.get('site-key', [])).toBeDefined()

    await replicaB.updateTags(['site:acme'], { expire: 0 })
    await replicaA.refreshTags()

    expect(await replicaA.get('site-key', [])).toBeUndefined()
    expect(await replicaA.getExpiration(['site:acme'])).toBeGreaterThan(0)
  })
})

describe('createRedisGetter', () => {
  function fakeClient() {
    const listeners: Record<string, (error: unknown) => void> = {}
    return {
      isReady: false,
      on: vi.fn((event: string, cb: (error: unknown) => void) => {
        listeners[event] = cb
      }),
      connect: vi.fn(async () => undefined),
      listeners,
    }
  }

  it('stays offline without REDIS_URL and during next build', () => {
    const createClient = vi.fn()
    const deps = { createClient, readFile: vi.fn(), log: vi.fn() }

    expect(createRedisGetter({}, deps)()).toBeNull()
    expect(
      createRedisGetter(
        { REDIS_URL: 'redis://x', NEXT_PHASE: 'phase-production-build' },
        deps,
      )(),
    ).toBeNull()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('creates one client lazily and hands it out only once ready', () => {
    const client = fakeClient()
    const createClient = vi.fn(() => client)
    const getRedis = createRedisGetter(
      { REDIS_URL: 'redis://localhost:6379' },
      { createClient, readFile: vi.fn(), log: vi.fn() },
    )

    expect(createClient).not.toHaveBeenCalled()
    expect(getRedis()).toBeNull()
    client.isReady = true
    expect(getRedis()).toBe(client)
    expect(createClient).toHaveBeenCalledTimes(1)

    const options = (createClient.mock.calls[0] as unknown[])[0] as {
      disableOfflineQueue: boolean
      socket: { reconnectStrategy: (n: number) => number; tls?: boolean }
    }
    expect(options.disableOfflineQueue).toBe(true)
    expect(options.socket.tls).toBeUndefined()
    expect(options.socket.reconnectStrategy(3)).toBe(600)
    expect(options.socket.reconnectStrategy(100)).toBe(5000)
  })

  it('uses TLS with the configured CA and logs connection problems', async () => {
    const client = fakeClient()
    client.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const createClient = vi.fn(() => client)
    const readFile = vi.fn(() => 'CA')
    const log = vi.fn()
    const getRedis = createRedisGetter(
      {
        REDIS_URL: 'rediss://redis:6379',
        REDIS_TLS_ENABLED: 'true',
        REDIS_TLS_CA_PATH: '/etc/redis-tls/ca.crt',
      },
      { createClient, readFile, log },
    )

    getRedis()
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        'next_cache.redis_connect_failed',
        expect.any(Error),
      ),
    )
    client.listeners.error(new Error('socket closed'))

    expect(readFile).toHaveBeenCalledWith('/etc/redis-tls/ca.crt')
    expect((createClient.mock.calls[0] as unknown[])[0]).toMatchObject({
      socket: { tls: true, ca: 'CA' },
    })
    expect(log).toHaveBeenCalledWith('next_cache.redis_error', expect.any(Error))
  })

  it('uses TLS without a CA file when none is configured', () => {
    const createClient = vi.fn(() => fakeClient())
    const readFile = vi.fn()
    createRedisGetter(
      { REDIS_URL: 'rediss://redis:6379', REDIS_TLS_ENABLED: 'true' },
      { createClient, readFile, log: vi.fn() },
    )()

    expect(readFile).not.toHaveBeenCalled()
    expect((createClient.mock.calls[0] as unknown[])[0]).toMatchObject({
      socket: { tls: true, ca: undefined },
    })
  })
})

describe('createHandlerFromEnv', () => {
  it('wraps a 50 MB default handler and honours the timeout override', async () => {
    const manifest = new Map<string, TagEntry>()
    const base = createFakeBase(manifest)
    const createDefault = vi.fn(() => base)
    const client = {
      isReady: true,
      on: vi.fn(),
      connect: vi.fn(async () => undefined),
      get: vi.fn(() => new Promise(() => undefined)),
    }
    const write = vi.fn()

    const handler = createHandlerFromEnv(
      { REDIS_URL: 'redis://localhost:6379', NEXT_CACHE_TAGS_TIMEOUT_MS: '5' },
      {
        createDefaultCacheHandler: createDefault,
        tagsManifest: manifest,
        createClient: () => client,
        readFile: vi.fn(),
        write,
      },
    )

    expect(createDefault).toHaveBeenCalledWith(50 * 1024 * 1024)
    await handler.refreshTags()
    expect(JSON.parse(write.mock.calls[0][0]).message).toBe(
      'next_cache.tags_refresh_failed',
    )
  })

  it('falls back to the default timeout for an invalid override', async () => {
    const handler = createHandlerFromEnv(
      { NEXT_CACHE_TAGS_TIMEOUT_MS: 'soon' },
      {
        createDefaultCacheHandler: () => createFakeBase(new Map()),
        tagsManifest: new Map(),
        createClient: vi.fn(),
        readFile: vi.fn(),
        write: vi.fn(),
      },
    )

    await expect(handler.refreshTags()).resolves.toBeUndefined()
  })
})

describe('handler.cjs', () => {
  it('exports a ready cache handler without touching Redis on import', async () => {
    const mod = await import('../next-cache/handler.cjs')
    const handler = (mod.default ?? mod) as Record<string, unknown>

    for (const method of [
      'get',
      'set',
      'refreshTags',
      'getExpiration',
      'updateTags',
    ]) {
      expect(typeof handler[method]).toBe('function')
    }
  })
})
