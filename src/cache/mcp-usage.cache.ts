import { logger } from '@/lib/axiom/logger'
import { ensureRedisConnected } from '@/src/lib/redis'

/**
 * MCP call counters per workspace, in Redis (no table): one hash per
 * workspace per day, `mcp:usage:<workspaceId>:<YYYY-MM-DD>`, with one field
 * per app (`c:<clientId>`) and one per grant (`g:<grantId>`). Each
 * `tools/call` increments both. Days follow America/Sao_Paulo, the
 * platform's schedule timezone, and keys live 32 days — enough for the
 * 30-day window.
 *
 * The counters are bookkeeping: a Redis failure never blocks a call (the
 * increment is lost) nor the admin screen (the counts read as zero).
 */

export const MCP_USAGE_TTL_SECONDS = 32 * 24 * 60 * 60
export const MCP_USAGE_WINDOW_DAYS = 30
const SHORT_WINDOW_DAYS = 7
const TIME_ZONE = 'America/Sao_Paulo'
const DAY_MS = 24 * 60 * 60 * 1000

export interface McpUsageCounts {
  last7Days: number
  last30Days: number
}

export interface McpWorkspaceUsage {
  byClient: Map<string, McpUsageCounts>
  byGrant: Map<string, McpUsageCounts>
}

export interface McpCallRef {
  workspaceId: string
  clientId: string
  grantId: string
}

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Calendar day of `at` in São Paulo, as `YYYY-MM-DD`. */
export function mcpUsageDay(at: Date): string {
  return dayFormat.format(at)
}

/** The `count` days ending at `now` (today first), São Paulo calendar. */
export function mcpUsageDays(now: Date, count: number): string[] {
  const today = Date.parse(`${mcpUsageDay(now)}T00:00:00Z`)
  return Array.from({ length: count }, (_, i) =>
    new Date(today - i * DAY_MS).toISOString().slice(0, 10),
  )
}

function usageKey(workspaceId: string, day: string): string {
  return `mcp:usage:${workspaceId}:${day}`
}

function warn(event: string, cause: unknown) {
  logger.warn(event, {
    component: 'McpUsageCache',
    message: cause instanceof Error ? cause.message : String(cause),
  })
}

function add(
  totals: Map<string, McpUsageCounts>,
  id: string,
  calls: number,
  recent: boolean,
) {
  const current = totals.get(id) ?? { last7Days: 0, last30Days: 0 }
  current.last30Days += calls
  if (recent) current.last7Days += calls
  totals.set(id, current)
}

export const McpUsageCache = {
  /** Counts one MCP tool call of a grant. Never throws. */
  async recordCall(ref: McpCallRef, now = new Date()): Promise<void> {
    try {
      const client = await ensureRedisConnected()
      const key = usageKey(ref.workspaceId, mcpUsageDay(now))
      await client
        .multi()
        .hIncrBy(key, `c:${ref.clientId}`, 1)
        .hIncrBy(key, `g:${ref.grantId}`, 1)
        .expire(key, MCP_USAGE_TTL_SECONDS)
        .exec()
    } catch (cause) {
      warn('cache.mcp_usage.record_failed', cause)
    }
  },

  /**
   * Calls of the last 7 and 30 days (today included) per app and per grant
   * of a workspace. Empty maps when Redis fails.
   */
  async readWorkspace(
    workspaceId: string,
    now = new Date(),
  ): Promise<McpWorkspaceUsage> {
    const usage: McpWorkspaceUsage = { byClient: new Map(), byGrant: new Map() }
    try {
      const client = await ensureRedisConnected()
      const days = mcpUsageDays(now, MCP_USAGE_WINDOW_DAYS)
      const pipeline = client.multi()
      for (const day of days) pipeline.hGetAll(usageKey(workspaceId, day))
      const hashes = (await pipeline.exec()) as unknown as Record<
        string,
        string
      >[]

      hashes.forEach((hash, index) => {
        const recent = index < SHORT_WINDOW_DAYS
        for (const [field, value] of Object.entries(hash)) {
          const calls = Number.parseInt(value, 10)
          if (!Number.isFinite(calls) || calls <= 0) continue
          const id = field.slice(2)
          if (field.startsWith('c:')) add(usage.byClient, id, calls, recent)
          else if (field.startsWith('g:')) add(usage.byGrant, id, calls, recent)
        }
      })
    } catch (cause) {
      warn('cache.mcp_usage.read_failed', cause)
      return { byClient: new Map(), byGrant: new Map() }
    }
    return usage
  },
}
