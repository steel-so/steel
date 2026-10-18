import { beforeEach, describe, expect, it, vi } from 'vitest'

const redis = vi.hoisted(() => {
  const tx = {
    hIncrBy: vi.fn(),
    expire: vi.fn(),
    exec: vi.fn(async () => []),
  }
  tx.hIncrBy.mockReturnValue(tx)
  tx.expire.mockReturnValue(tx)
  return { tx, multi: vi.fn(() => tx), hGetAll: vi.fn() }
})
const connect = vi.hoisted(() => vi.fn())

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/redis', () => ({ ensureRedisConnected: connect }))

import { logger } from '@/lib/axiom/logger'
import {
  MCP_TOOL_USAGE_TTL_SECONDS,
  mcpToolUsageKey,
  previousUsageMonth,
  readMcpToolUsage,
  recordMcpToolUsage,
  sumUsageHashes,
  usageMonth,
} from '@/src/lib/mcp/tool-usage'

beforeEach(() => {
  vi.clearAllMocks()
  connect.mockResolvedValue(redis)
})

describe('months', () => {
  it('should use São Paulo time', () => {
    // 02:00 UTC on the 1st is still the previous month in São Paulo.
    expect(usageMonth(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10')
    expect(usageMonth(new Date('2026-11-01T04:00:00Z'))).toBe('2026-11')
  })

  it('should step back a month across the year', () => {
    expect(previousUsageMonth('2026-10')).toBe('2026-09')
    expect(previousUsageMonth('2026-01')).toBe('2025-12')
  })

  it('should key by workspace and month', () => {
    expect(mcpToolUsageKey('ws1', '2026-10')).toBe('mcp:tool-usage:ws1:2026-10')
  })
})

describe('recordMcpToolUsage()', () => {
  it('should increment the tool in the month hash and refresh the TTL', async () => {
    await recordMcpToolUsage('ws1', 'sd_list', new Date('2026-10-17T12:00:00Z'))
    const key = 'mcp:tool-usage:ws1:2026-10'
    expect(redis.tx.hIncrBy).toHaveBeenCalledWith(key, 'sd_list', 1)
    expect(redis.tx.expire).toHaveBeenCalledWith(
      key,
      MCP_TOOL_USAGE_TTL_SECONDS,
    )
    expect(redis.tx.exec).toHaveBeenCalled()
  })

  it('should swallow Redis failures with a warning', async () => {
    connect.mockRejectedValueOnce(new Error('down'))
    await expect(recordMcpToolUsage('ws1', 'sd_list')).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      'mcp.tool_usage.record_failed',
      expect.objectContaining({ workspaceId: 'ws1', message: 'down' }),
    )
  })
})

describe('readMcpToolUsage()', () => {
  it('should sum the current and the previous month', async () => {
    redis.hGetAll.mockImplementation(async (key: string) =>
      key.endsWith('2026-10') ? { a: '2', b: '1' } : { a: '3', c: 'x' },
    )
    expect(
      await readMcpToolUsage('ws1', new Date('2026-10-17T12:00:00Z')),
    ).toEqual({ a: 5, b: 1 })
    expect(redis.hGetAll).toHaveBeenCalledWith('mcp:tool-usage:ws1:2026-09')
  })

  it('should fall back to no usage when Redis fails', async () => {
    connect.mockRejectedValueOnce('down')
    expect(await readMcpToolUsage('ws1')).toEqual({})
    expect(logger.warn).toHaveBeenCalledWith(
      'mcp.tool_usage.read_failed',
      expect.objectContaining({ message: 'down' }),
    )
  })
})

describe('sumUsageHashes()', () => {
  it('should ignore zero, negative and non-numeric counts', () => {
    expect(sumUsageHashes([{ a: '0', b: '-1', c: 'NaN', d: '4' }])).toEqual({
      d: 4,
    })
  })
})
