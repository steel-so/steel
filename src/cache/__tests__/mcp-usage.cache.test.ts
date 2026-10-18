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
  MCP_USAGE_TTL_SECONDS,
  McpUsageCache,
  mcpUsageDay,
  mcpUsageDays,
} from '@/src/cache/mcp-usage.cache'
import * as redisModule from '@/src/lib/redis'
import { ensureRedisConnected, redis } from '@/src/lib/redis'

const used: string[] = []

function workspaceId() {
  const id = createId()
  used.push(id)
  return id
}

// 15:00 UTC = 12:00 in São Paulo.
const NOW = new Date('2026-10-17T15:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

beforeAll(async () => {
  await ensureRedisConnected()
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const id of used.splice(0)) {
    const keys = await redis.keys(`mcp:usage:${id}:*`)
    if (keys.length > 0) await redis.del(keys)
  }
})

afterAll(async () => {
  if (redis.isOpen) await redis.disconnect()
})

describe('mcpUsageDay() / mcpUsageDays()', () => {
  it('uses the São Paulo calendar day', () => {
    expect(mcpUsageDay(new Date('2026-10-18T02:00:00Z'))).toBe('2026-10-17')
    expect(mcpUsageDay(new Date('2026-10-18T03:00:00Z'))).toBe('2026-10-18')
  })

  it('lists the window ending today, today first, across month edges', () => {
    expect(mcpUsageDays(new Date('2026-11-02T12:00:00Z'), 4)).toEqual([
      '2026-11-02',
      '2026-11-01',
      '2026-10-31',
      '2026-10-30',
    ])
  })
})

describe('McpUsageCache', () => {
  it('counts calls per app and per grant, with a TTL', async () => {
    const ws = workspaceId()
    const ref = { workspaceId: ws, clientId: 'client-a', grantId: 'grant-1' }
    await McpUsageCache.recordCall(ref, NOW)
    await McpUsageCache.recordCall(ref, NOW)
    await McpUsageCache.recordCall({ ...ref, grantId: 'grant-2' }, NOW)

    const key = `mcp:usage:${ws}:2026-10-17`
    expect(await redis.hGetAll(key)).toEqual({
      'c:client-a': '3',
      'g:grant-1': '2',
      'g:grant-2': '1',
    })
    const ttl = await redis.ttl(key)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(MCP_USAGE_TTL_SECONDS)
  })

  it('sums the last 7 and 30 days and ignores older or foreign fields', async () => {
    const ws = workspaceId()
    const ref = { workspaceId: ws, clientId: 'client-a', grantId: 'grant-1' }
    await McpUsageCache.recordCall(ref, NOW)
    await McpUsageCache.recordCall(ref, new Date(NOW.getTime() - 6 * DAY_MS))
    await McpUsageCache.recordCall(ref, new Date(NOW.getTime() - 7 * DAY_MS))
    await McpUsageCache.recordCall(ref, new Date(NOW.getTime() - 29 * DAY_MS))
    await McpUsageCache.recordCall(ref, new Date(NOW.getTime() - 30 * DAY_MS))
    await McpUsageCache.recordCall(
      { workspaceId: ws, clientId: 'client-b', grantId: 'grant-9' },
      NOW,
    )
    await redis.hSet(`mcp:usage:${ws}:2026-10-17`, {
      junk: '5',
      'c:client-z': 'nope',
      'g:grant-0': '0',
    })

    const usage = await McpUsageCache.readWorkspace(ws, NOW)
    expect(usage.byClient.get('client-a')).toEqual({
      last7Days: 2,
      last30Days: 4,
    })
    expect(usage.byGrant.get('grant-1')).toEqual({
      last7Days: 2,
      last30Days: 4,
    })
    expect(usage.byClient.get('client-b')).toEqual({
      last7Days: 1,
      last30Days: 1,
    })
    expect(usage.byClient.has('client-z')).toBe(false)
    expect(usage.byGrant.has('grant-0')).toBe(false)
  })

  it('reads an empty workspace and uses the current date by default', async () => {
    const ws = workspaceId()
    await McpUsageCache.recordCall({
      workspaceId: ws,
      clientId: 'c',
      grantId: 'g',
    })
    const usage = await McpUsageCache.readWorkspace(ws)
    expect(usage.byClient.get('c')?.last7Days).toBe(1)

    const empty = await McpUsageCache.readWorkspace(workspaceId(), NOW)
    expect(empty.byClient.size).toBe(0)
    expect(empty.byGrant.size).toBe(0)
  })

  it('never throws when Redis fails', async () => {
    vi.spyOn(redisModule, 'ensureRedisConnected').mockRejectedValue(
      new Error('down'),
    )
    await expect(
      McpUsageCache.recordCall(
        { workspaceId: 'w', clientId: 'c', grantId: 'g' },
        NOW,
      ),
    ).resolves.toBeUndefined()
    const usage = await McpUsageCache.readWorkspace('w', NOW)
    expect(usage.byClient.size).toBe(0)

    vi.spyOn(redisModule, 'ensureRedisConnected').mockRejectedValue('down')
    expect((await McpUsageCache.readWorkspace('w', NOW)).byGrant.size).toBe(0)
  })
})
