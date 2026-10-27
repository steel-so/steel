import type {
  WorkspaceAccessOutcome,
  WorkspaceAccessSurface,
} from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { UserRepository } from '@/src/repositories/user.repository'
import { WorkspaceAccessLogRepository } from '@/src/repositories/workspace-access-log.repository'

/**
 * Writes one entry of the IP-restricted workspace log (ADR 0053). Called
 * fire-and-forget by `assertIpAllowed`: it never throws and never rejects,
 * so a Redis or database failure costs the row, not the request.
 */

/** Longest stored `path` / `userAgent` (both come from the client). */
export const ACCESS_LOG_TEXT_LIMIT = 512

export interface WorkspaceAccessAttempt {
  workspaceId: string
  userId: string
  ip: string | null
  userAgent: string | null
  outcome: WorkspaceAccessOutcome
  surface: WorkspaceAccessSurface
  path: string | null
}

function clip(value: string | null): string | null {
  if (!value) return null
  return value.length > ACCESS_LOG_TEXT_LIMIT
    ? value.slice(0, ACCESS_LOG_TEXT_LIMIT)
    : value
}

function warn(event: string, attempt: WorkspaceAccessAttempt, cause: unknown) {
  logger.warn(event, {
    component: 'WorkspaceAccessLog',
    workspaceId: attempt.workspaceId,
    userId: attempt.userId,
    outcome: attempt.outcome,
    message: cause instanceof Error ? cause.message : String(cause),
  })
}

export async function recordWorkspaceAccess(
  attempt: WorkspaceAccessAttempt,
): Promise<void> {
  const key = {
    workspaceId: attempt.workspaceId,
    userId: attempt.userId,
    ip: attempt.ip,
    outcome: attempt.outcome,
    surface: attempt.surface,
  }
  try {
    // Loaded on demand: `authz.ts` imports this module, and pulling the
    // Redis client into every importer of authz breaks their env mocks.
    const { WorkspaceAccessLogCache } = await import(
      '@/src/cache/workspace-access-log.cache'
    )
    if (!(await WorkspaceAccessLogCache.claim(key))) return

    // Snapshot of who it was: the row must still say it after the user is
    // deleted. A failed lookup keeps the id and records the attempt anyway.
    const user = await UserRepository.findById(attempt.userId)
    const created = await WorkspaceAccessLogRepository.create({
      workspaceId: attempt.workspaceId,
      userId: attempt.userId,
      userEmail: user.ok ? user.value.email : null,
      userName: user.ok ? user.value.name : null,
      ip: attempt.ip,
      userAgent: clip(attempt.userAgent),
      outcome: attempt.outcome,
      surface: attempt.surface,
      path: clip(attempt.path),
    })
    if (!created.ok) {
      await WorkspaceAccessLogCache.release(key)
      warn('workspace.access_log.write_failed', attempt, created.error.message)
    }
  } catch (cause) {
    warn('workspace.access_log.write_failed', attempt, cause)
  }
}
