import { logger } from '@/lib/axiom/logger'
import { ensureRedisConnected } from '../redis'

/**
 * How often each Steel AI tool is called over MCP in a workspace — the
 * signal `tools/list` uses to pick the "most-used categories" when a grant
 * exposes too many tools (`src/lib/mcp/discovery.ts`).
 *
 * One Redis hash per workspace and month (`HINCRBY`, O(1), no Postgres write
 * per call); the field is the tool name. Reads sum the current and the
 * previous month, so the ranking follows recent use and a new month does
 * not start from zero. Counts are per workspace (not per user or client):
 * the ranking is a product hint, never an authorization input.
 */

export const MCP_TOOL_USAGE_KEY_PREFIX = 'mcp:tool-usage:'
/** Two months and a bit: the previous month is still read on day 31. */
export const MCP_TOOL_USAGE_TTL_SECONDS = 62 * 24 * 60 * 60
const USAGE_TIMEZONE = 'America/Sao_Paulo'

const monthFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: USAGE_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
})

/** `YYYY-MM` of `date` in São Paulo time. */
export function usageMonth(date: Date): string {
  const parts = monthFormatter.formatToParts(date)
  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  return `${year}-${month}`
}

/** `YYYY-MM` of the month before `month`. */
export function previousUsageMonth(month: string): string {
  const [year, mm] = month.split('-').map(Number)
  return mm === 1
    ? `${year - 1}-12`
    : `${year}-${String(mm - 1).padStart(2, '0')}`
}

export function mcpToolUsageKey(workspaceId: string, month: string): string {
  return `${MCP_TOOL_USAGE_KEY_PREFIX}${workspaceId}:${month}`
}

function warn(event: string, workspaceId: string, cause: unknown) {
  logger.warn(event, {
    component: 'McpToolUsage',
    workspaceId,
    message: cause instanceof Error ? cause.message : String(cause),
  })
}

/** Counts one call. Never throws: a counter must not fail the tool call. */
export async function recordMcpToolUsage(
  workspaceId: string,
  toolName: string,
  now: Date = new Date(),
): Promise<void> {
  const key = mcpToolUsageKey(workspaceId, usageMonth(now))
  try {
    const client = await ensureRedisConnected()
    await client
      .multi()
      .hIncrBy(key, toolName, 1)
      .expire(key, MCP_TOOL_USAGE_TTL_SECONDS)
      .exec()
  } catch (cause) {
    warn('mcp.tool_usage.record_failed', workspaceId, cause)
  }
}

/** Sums hashes of tool → count, ignoring non-numeric values. */
export function sumUsageHashes(
  hashes: readonly Record<string, string>[],
): Record<string, number> {
  const total: Record<string, number> = {}
  for (const hash of hashes) {
    for (const [tool, raw] of Object.entries(hash)) {
      const value = Number.parseInt(raw, 10)
      if (!Number.isFinite(value) || value <= 0) continue
      total[tool] = (total[tool] ?? 0) + value
    }
  }
  return total
}

/**
 * Calls per tool name in the current and previous month. Never throws:
 * without Redis the ranking falls back to the default order (empty map).
 */
export async function readMcpToolUsage(
  workspaceId: string,
  now: Date = new Date(),
): Promise<Record<string, number>> {
  const month = usageMonth(now)
  try {
    const client = await ensureRedisConnected()
    const hashes = await Promise.all([
      client.hGetAll(mcpToolUsageKey(workspaceId, month)),
      client.hGetAll(mcpToolUsageKey(workspaceId, previousUsageMonth(month))),
    ])
    return sumUsageHashes(hashes)
  } catch (cause) {
    warn('mcp.tool_usage.read_failed', workspaceId, cause)
    return {}
  }
}
