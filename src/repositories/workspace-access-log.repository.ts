import type {
  Prisma,
  WorkspaceAccessLog,
  WorkspaceAccessOutcome,
  WorkspaceAccessSurface,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Entry log of IP-restricted workspaces (ADR 0053). */

export interface WorkspaceAccessLogFilter {
  workspaceId: string
  /** Inclusive instant. */
  from: Date
  /** Exclusive instant. */
  to: Date
  outcome?: WorkspaceAccessOutcome
  surface?: WorkspaceAccessSurface
  /** Exact user id, or part of the name/e-mail snapshot. */
  user?: string
}

export interface CreateWorkspaceAccessLogData {
  workspaceId: string
  userId: string | null
  userEmail: string | null
  userName: string | null
  ip: string | null
  userAgent: string | null
  outcome: WorkspaceAccessOutcome
  surface: WorkspaceAccessSurface
  path: string | null
}

/** Keyset cursor of the export (ascending `createdAt`, then `id`). */
export interface WorkspaceAccessLogCursor {
  createdAt: Date
  id: string
}

function toWhere(
  filter: WorkspaceAccessLogFilter,
): Prisma.WorkspaceAccessLogWhereInput {
  return {
    workspaceId: filter.workspaceId,
    createdAt: { gte: filter.from, lt: filter.to },
    ...(filter.outcome ? { outcome: filter.outcome } : {}),
    ...(filter.surface ? { surface: filter.surface } : {}),
    ...(filter.user
      ? {
          OR: [
            { userId: filter.user },
            { userEmail: { contains: filter.user, mode: 'insensitive' } },
            { userName: { contains: filter.user, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
}

export const WorkspaceAccessLogRepository = {
  async create(
    data: CreateWorkspaceAccessLogData,
  ): Promise<Result<WorkspaceAccessLog>> {
    try {
      return ok(await prisma.workspaceAccessLog.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create workspace access log', error))
    }
  },

  /** One page, most recent first, with the filtered total. */
  async listPage(
    filter: WorkspaceAccessLogFilter,
    page: { skip: number; take: number },
  ): Promise<Result<{ rows: WorkspaceAccessLog[]; total: number }>> {
    try {
      const where = toWhere(filter)
      const [rows, total] = await prisma.$transaction([
        prisma.workspaceAccessLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: page.skip,
          take: page.take,
        }),
        prisma.workspaceAccessLog.count({ where }),
      ])
      return ok({ rows, total })
    } catch (error) {
      return err(dbError('Failed to list workspace access logs', error))
    }
  },

  async count(filter: WorkspaceAccessLogFilter): Promise<Result<number>> {
    try {
      return ok(
        await prisma.workspaceAccessLog.count({ where: toWhere(filter) }),
      )
    } catch (error) {
      return err(dbError('Failed to count workspace access logs', error))
    }
  },

  /** Export batch in chronological order, after `cursor` when given. */
  async listBatch(
    filter: WorkspaceAccessLogFilter,
    take: number,
    cursor?: WorkspaceAccessLogCursor,
  ): Promise<Result<WorkspaceAccessLog[]>> {
    try {
      const where = toWhere(filter)
      const rows = await prisma.workspaceAccessLog.findMany({
        where: cursor
          ? {
              AND: [
                where,
                {
                  OR: [
                    { createdAt: { gt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                  ],
                },
              ],
            }
          : where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to read workspace access log batch', error))
    }
  },

  /** Retention (ADR 0053): rows older than `cutoff`, every workspace. */
  async deleteOlderThan(cutoff: Date): Promise<Result<number>> {
    try {
      const { count } = await prisma.workspaceAccessLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to prune workspace access logs', error))
    }
  },
}
