import type {
  WorkspaceAccessOutcome,
  WorkspaceAccessSurface,
} from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { ensureRedisConnected } from '@/src/lib/redis'

/**
 * Dedupe of the IP-restricted workspace entry log (ADR 0053). Every API
 * call runs the IP check, so one browsing session would write hundreds of
 * identical rows. A `SET NX EX` key per workspace + user + IP + outcome +
 * surface lets one row through per window:
 *
 * - ALLOWED: 30 minutes — "this person was inside from this network" is the
 *   fact the audit needs, not each click;
 * - BLOCKED: 1 minute — attempts from outside are the security signal, so
 *   they keep a much finer grain while still absorbing a page's burst of
 *   parallel API calls.
 *
 * Redis down → `claim` answers `true` (fail-open): a duplicated row is
 * better than a lost one in a compliance log.
 */

export const ACCESS_LOG_DEDUPE_SECONDS: Record<WorkspaceAccessOutcome, number> =
  {
    ALLOWED: 30 * 60,
    BLOCKED: 60,
  }

export interface AccessLogDedupeKey {
  workspaceId: string
  userId: string
  ip: string | null
  outcome: WorkspaceAccessOutcome
  surface: WorkspaceAccessSurface
}

export function accessLogDedupeKey(key: AccessLogDedupeKey): string {
  return [
    'ws:access-log',
    key.workspaceId,
    key.userId,
    key.ip ?? 'unknown',
    key.outcome,
    key.surface,
  ].join(':')
}

function warn(event: string, cause: unknown) {
  logger.warn(event, {
    component: 'WorkspaceAccessLogCache',
    message: cause instanceof Error ? cause.message : String(cause),
  })
}

export const WorkspaceAccessLogCache = {
  /** `true` when this attempt is the first of its window (write the row). */
  async claim(key: AccessLogDedupeKey): Promise<boolean> {
    try {
      const client = await ensureRedisConnected()
      const set = await client.set(accessLogDedupeKey(key), '1', {
        NX: true,
        EX: ACCESS_LOG_DEDUPE_SECONDS[key.outcome],
      })
      return set === 'OK'
    } catch (cause) {
      warn('cache.workspace_access_log.claim_failed', cause)
      return true
    }
  },

  /** Frees the window after a failed write, so the next attempt retries. */
  async release(key: AccessLogDedupeKey): Promise<void> {
    try {
      const client = await ensureRedisConnected()
      await client.del(accessLogDedupeKey(key))
    } catch (cause) {
      warn('cache.workspace_access_log.release_failed', cause)
    }
  },
}
