import { createId } from '@paralleldrive/cuid2'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  ACCESS_LOG_DEDUPE_SECONDS,
  type AccessLogDedupeKey,
  accessLogDedupeKey,
  WorkspaceAccessLogCache,
} from '@/src/cache/workspace-access-log.cache'
import * as redisModule from '@/src/lib/redis'
import { ensureRedisConnected, redis } from '@/src/lib/redis'

const used: string[] = []

function key(extra?: Partial<AccessLogDedupeKey>): AccessLogDedupeKey {
  const workspaceId = createId()
  used.push(workspaceId)
  return {
    workspaceId,
    userId: 'u_1',
    ip: '200.1.2.3',
    outcome: 'ALLOWED',
    surface: 'APP',
    ...extra,
  }
}

beforeAll(async () => {
  await ensureRedisConnected()
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const id of used.splice(0)) {
    const keys = await redis.keys(`ws:access-log:${id}:*`)
    if (keys.length > 0) await redis.del(keys)
  }
})

afterAll(async () => {
  if (redis.isOpen) await redis.disconnect()
})

describe('WorkspaceAccessLogCache', () => {
  it('builds one key per workspace, user, IP, outcome and surface', () => {
    expect(
      accessLogDedupeKey({
        workspaceId: 'ws',
        userId: 'u',
        ip: null,
        outcome: 'BLOCKED',
        surface: 'API',
      }),
    ).toBe('ws:access-log:ws:u:unknown:BLOCKED:API')
  })

  it('lets the first attempt of a window through, once', async () => {
    const k = key()
    expect(await WorkspaceAccessLogCache.claim(k)).toBe(true)
    expect(await WorkspaceAccessLogCache.claim(k)).toBe(false)
    // Another outcome, surface or IP is another fact.
    expect(
      await WorkspaceAccessLogCache.claim({ ...k, outcome: 'BLOCKED' }),
    ).toBe(true)
    expect(await WorkspaceAccessLogCache.claim({ ...k, surface: 'API' })).toBe(
      true,
    )
    expect(await WorkspaceAccessLogCache.claim({ ...k, ip: '8.8.8.8' })).toBe(
      true,
    )
  })

  it('uses 30 minutes for allowed and 1 minute for blocked', async () => {
    expect(ACCESS_LOG_DEDUPE_SECONDS).toEqual({ ALLOWED: 1800, BLOCKED: 60 })
    const allowed = key()
    const blocked = key({ outcome: 'BLOCKED' })
    await WorkspaceAccessLogCache.claim(allowed)
    await WorkspaceAccessLogCache.claim(blocked)
    const allowedTtl = await redis.ttl(accessLogDedupeKey(allowed))
    const blockedTtl = await redis.ttl(accessLogDedupeKey(blocked))
    expect(allowedTtl).toBeGreaterThan(1790)
    expect(allowedTtl).toBeLessThanOrEqual(1800)
    expect(blockedTtl).toBeGreaterThan(50)
    expect(blockedTtl).toBeLessThanOrEqual(60)
  })

  it('release() reopens the window', async () => {
    const k = key()
    await WorkspaceAccessLogCache.claim(k)
    await WorkspaceAccessLogCache.release(k)
    expect(await WorkspaceAccessLogCache.claim(k)).toBe(true)
  })

  it('fails open when Redis is down, and release() swallows errors', async () => {
    vi.spyOn(redisModule, 'ensureRedisConnected').mockRejectedValue(
      new Error('redis down'),
    )
    expect(await WorkspaceAccessLogCache.claim(key())).toBe(true)
    await expect(
      WorkspaceAccessLogCache.release(key()),
    ).resolves.toBeUndefined()
  })
})
