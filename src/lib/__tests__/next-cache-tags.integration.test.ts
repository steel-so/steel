import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createSharedTagsCacheHandler } from '@/lib/next-cache/shared-tags.cjs'
import { ensureRedisConnected, redis } from '@/src/lib/redis'

/**
 * The tag merge runs as a Lua script inside Redis; the unit suite only
 * mirrors it. This runs the real script against the real Redis.
 */

type TagEntry = { stale?: number; expired?: number }

const PREFIX = `test:next-cache:${process.pid}`
const KEYS = ['stale', 'expired', 'version'].map((k) => `${PREFIX}:tags:${k}`)

function replica(updates: TagEntry) {
  const manifest = new Map<string, TagEntry>()
  const handler = createSharedTagsCacheHandler({
    base: {
      get: async () => undefined,
      set: async () => undefined,
      refreshTags: async () => undefined,
      getExpiration: async () => 0,
      updateTags: async (tags: string[]) => {
        for (const tag of tags) manifest.set(tag, { ...updates })
      },
    },
    manifest,
    getRedis: () => redis as never,
    log: vi.fn(),
    timeoutMs: 2000,
    keyPrefix: PREFIX,
  })
  return { manifest, handler }
}

describe('shared tag state in Redis', () => {
  afterEach(async () => {
    await redis.del(KEYS)
  })

  afterAll(async () => {
    if (redis.isOpen) await redis.quit()
  })

  it('propagates a revalidation to another replica, never moving a tag back', async () => {
    await ensureRedisConnected()
    const newer = replica({ stale: 2000, expired: 2000 })
    const older = replica({ stale: 1000 })
    const reader = replica({})

    await newer.handler.updateTags(['site:acme'], { expire: 0 })
    // A slower replica publishing an older revalidation afterwards.
    await older.handler.updateTags(['site:acme', 'site:other'])

    expect(await redis.hGetAll(KEYS[0])).toEqual({
      'site:acme': '2000',
      'site:other': '1000',
    })
    expect(await redis.hGetAll(KEYS[1])).toEqual({ 'site:acme': '2000' })
    expect(await redis.get(KEYS[2])).toBe('2')

    await reader.handler.refreshTags()
    expect(reader.manifest.get('site:acme')).toEqual({
      stale: 2000,
      expired: 2000,
    })
    expect(reader.manifest.get('site:other')).toEqual({ stale: 1000 })
  })
})
