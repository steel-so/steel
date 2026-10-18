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
  hashMcpArgs,
  MCP_IDEMPOTENCY_PENDING_TTL_SECONDS,
  MCP_IDEMPOTENCY_TTL_SECONDS,
  McpIdempotencyCache,
  type McpIdempotencyScope,
} from '@/src/cache/mcp-idempotency.cache'
import * as redisModule from '@/src/lib/redis'
import { ensureRedisConnected, redis } from '@/src/lib/redis'

const grants: string[] = []

function scope(overrides: Partial<McpIdempotencyScope> = {}) {
  const grantId = overrides.grantId ?? createId()
  grants.push(grantId)
  return { grantId, toolName: 'sd_create_ticket', key: 'k-1', ...overrides }
}

async function keysOf(grantId: string) {
  return redis.keys(`mcp:idem:${grantId}:*`)
}

beforeAll(async () => {
  await ensureRedisConnected()
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const grantId of grants.splice(0)) {
    const keys = await keysOf(grantId)
    if (keys.length > 0) await redis.del(keys)
  }
})

afterAll(async () => {
  if (redis.isOpen) await redis.disconnect()
})

describe('hashMcpArgs()', () => {
  it('should ignore key order and undefined values', () => {
    expect(hashMcpArgs({ a: 1, b: { c: [1, 'x'], d: null } })).toBe(
      hashMcpArgs({ b: { d: null, c: [1, 'x'] }, a: 1, e: undefined }),
    )
    expect(hashMcpArgs({ a: 1 })).not.toBe(hashMcpArgs({ a: 2 }))
  })
})

describe('McpIdempotencyCache', () => {
  it('should claim once, then report in progress until completed', async () => {
    const s = scope()
    const hash = hashMcpArgs({ title: 'x' })

    expect(await McpIdempotencyCache.claim(s, hash)).toEqual({
      status: 'claimed',
    })
    expect(await McpIdempotencyCache.claim(s, hash)).toEqual({
      status: 'in_progress',
    })
    const [key] = await keysOf(s.grantId)
    expect(key).not.toContain('k-1')
    expect(await redis.ttl(key)).toBeLessThanOrEqual(
      MCP_IDEMPOTENCY_PENDING_TTL_SECONDS,
    )

    const result = { content: [{ type: 'text', text: 'ok' }] }
    await McpIdempotencyCache.complete(s, hash, result)
    expect(await McpIdempotencyCache.claim(s, hash)).toEqual({
      status: 'replay',
      result,
    })
    expect(await redis.ttl(key)).toBeGreaterThan(
      MCP_IDEMPOTENCY_PENDING_TTL_SECONDS,
    )
    expect(await redis.ttl(key)).toBeLessThanOrEqual(
      MCP_IDEMPOTENCY_TTL_SECONDS,
    )
  })

  it('should flag the same key with other arguments', async () => {
    const s = scope()
    await McpIdempotencyCache.claim(s, hashMcpArgs({ a: 1 }))
    expect(await McpIdempotencyCache.claim(s, hashMcpArgs({ a: 2 }))).toEqual({
      status: 'mismatch',
    })
  })

  it('should scope keys by grant and tool', async () => {
    const s = scope()
    const hash = hashMcpArgs({})
    await McpIdempotencyCache.claim(s, hash)
    expect(
      (await McpIdempotencyCache.claim({ ...s, toolName: 'other' }, hash))
        .status,
    ).toBe('claimed')
    expect((await McpIdempotencyCache.claim(scope(), hash)).status).toBe(
      'claimed',
    )
  })

  it('should let a released key run again', async () => {
    const s = scope()
    const hash = hashMcpArgs({})
    await McpIdempotencyCache.claim(s, hash)
    await McpIdempotencyCache.release(s)
    expect((await McpIdempotencyCache.claim(s, hash)).status).toBe('claimed')
  })

  it('should treat an unreadable entry as in progress', async () => {
    const s = scope()
    await McpIdempotencyCache.claim(s, 'h')
    const [key] = await keysOf(s.grantId)
    await redis.set(key, 'not json')
    expect((await McpIdempotencyCache.claim(s, 'h')).status).toBe('in_progress')
    await redis.set(key, JSON.stringify({ state: 'done' }))
    expect((await McpIdempotencyCache.claim(s, 'h')).status).toBe('in_progress')
  })

  it('should retry when the entry vanished between SET and GET', async () => {
    const s = scope()
    const client = await ensureRedisConnected()
    const get = vi.spyOn(client, 'get').mockResolvedValueOnce(null)
    const set = vi
      .spyOn(client, 'set')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('OK')
    expect((await McpIdempotencyCache.claim(s, 'h')).status).toBe('claimed')
    expect(set).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenCalledTimes(1)

    set.mockResolvedValue(null)
    get.mockResolvedValue(null)
    expect((await McpIdempotencyCache.claim(s, 'h')).status).toBe('in_progress')
  })

  it('should fail open when Redis is unavailable', async () => {
    vi.spyOn(redisModule, 'ensureRedisConnected').mockRejectedValue(
      new Error('down'),
    )
    const s = scope()
    expect(await McpIdempotencyCache.claim(s, 'h')).toEqual({
      status: 'unavailable',
    })
    await expect(McpIdempotencyCache.complete(s, 'h', {})).resolves.toBe(
      undefined,
    )
    await expect(McpIdempotencyCache.release(s)).resolves.toBe(undefined)
  })

  it('should log non-Error failures too', async () => {
    vi.spyOn(redisModule, 'ensureRedisConnected').mockRejectedValue('down')
    expect((await McpIdempotencyCache.claim(scope(), 'h')).status).toBe(
      'unavailable',
    )
  })
})
