import type { AiInsight, ModuleKind, Prisma } from '@prisma/client'
import type {
  ExistingInsightRow,
  InsightReconcilePlan,
} from '@/src/lib/ai/proactive/reconcile'
import type { AiInsightDraft } from '@/src/lib/ai/proactive/rules'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { AiInsightStateDTO } from '@/types/ai-insight'
import { dbError } from './db-error'

/**
 * Proactive AI insights (ADR 0040), pure Prisma. The episode rule lives in
 * `src/lib/ai/proactive/reconcile.ts`; this file only applies its plan.
 */

export interface AiInsightCounts {
  active: number
  snoozed: number
  dismissed: number
}

export interface AiInsightApplyResult {
  created: number
  refreshed: number
  reopened: number
  resolved: number
}

/** Rows of a user in one feed state at `now`. */
export function insightStateWhere(
  state: AiInsightStateDTO,
  now: Date,
): Prisma.AiInsightWhereInput {
  switch (state) {
    case 'active':
      return {
        status: 'ACTIVE',
        dismissedAt: null,
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      }
    case 'snoozed':
      return {
        status: 'ACTIVE',
        dismissedAt: null,
        snoozedUntil: { gt: now },
      }
    case 'dismissed':
      return { status: 'ACTIVE', dismissedAt: { not: null } }
  }
}

function draftContent(draft: AiInsightDraft) {
  return {
    kind: draft.kind,
    module: draft.module,
    severity: draft.severity,
    title: draft.title,
    body: draft.body,
    facts: draft.facts as unknown as Prisma.InputJsonValue,
    href: draft.href,
    prompt: draft.prompt,
  }
}

export const AiInsightRepository = {
  /** A user's insights in one state, most severe and most recent first. */
  async listForUser(
    workspaceId: string,
    userId: string,
    filter: {
      state: AiInsightStateDTO
      modules: ModuleKind[]
      now: Date
      limit: number
    },
  ): Promise<Result<AiInsight[]>> {
    if (filter.modules.length === 0) return ok([])
    try {
      const rows = await prisma.aiInsight.findMany({
        where: {
          workspaceId,
          userId,
          module: { in: filter.modules },
          ...insightStateWhere(filter.state, filter.now),
        },
        orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }, { id: 'asc' }],
        take: filter.limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list AI insights', error))
    }
  },

  async countsForUser(
    workspaceId: string,
    userId: string,
    modules: ModuleKind[],
    now: Date,
  ): Promise<Result<AiInsightCounts>> {
    if (modules.length === 0) return ok({ active: 0, snoozed: 0, dismissed: 0 })
    try {
      const base = { workspaceId, userId, module: { in: modules } }
      const [active, snoozed, dismissed] = await Promise.all([
        prisma.aiInsight.count({
          where: { ...base, ...insightStateWhere('active', now) },
        }),
        prisma.aiInsight.count({
          where: { ...base, ...insightStateWhere('snoozed', now) },
        }),
        prisma.aiInsight.count({
          where: { ...base, ...insightStateWhere('dismissed', now) },
        }),
      ])
      return ok({ active, snoozed, dismissed })
    } catch (error) {
      return err(dbError('Failed to count AI insights', error))
    }
  },

  /** One insight of the user (`null` when missing or someone else's). */
  async findForUser(
    id: string,
    workspaceId: string,
    userId: string,
  ): Promise<Result<AiInsight | null>> {
    try {
      const row = await prisma.aiInsight.findFirst({
        where: { id, workspaceId, userId },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find AI insight', error))
    }
  },

  async updateState(
    id: string,
    data: { dismissedAt: Date | null; snoozedUntil: Date | null },
  ): Promise<Result<AiInsight>> {
    try {
      const row = await prisma.aiInsight.update({ where: { id }, data })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to update AI insight', error))
    }
  },

  /** Every row of the workspace, as the reconcile plan needs them. */
  async listForReconcile(
    workspaceId: string,
  ): Promise<Result<ExistingInsightRow[]>> {
    try {
      const rows = await prisma.aiInsight.findMany({
        where: { workspaceId },
        select: {
          id: true,
          userId: true,
          dedupeKey: true,
          module: true,
          status: true,
        },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list AI insights to reconcile', error))
    }
  },

  /** Applies a reconcile plan in one transaction. */
  async applyPlan(
    workspaceId: string,
    plan: InsightReconcilePlan,
    now: Date,
  ): Promise<Result<AiInsightApplyResult>> {
    try {
      await prisma.$transaction([
        ...(plan.create.length > 0
          ? [
              prisma.aiInsight.createMany({
                data: plan.create.map((draft) => ({
                  workspaceId,
                  userId: draft.userId,
                  dedupeKey: draft.dedupeKey,
                  ...draftContent(draft),
                  status: 'ACTIVE' as const,
                  firstSeenAt: now,
                  lastSeenAt: now,
                })),
                skipDuplicates: true,
              }),
            ]
          : []),
        ...plan.refresh.map(({ id, draft }) =>
          prisma.aiInsight.update({
            where: { id },
            data: { ...draftContent(draft), lastSeenAt: now },
          }),
        ),
        ...plan.reopen.map(({ id, draft }) =>
          prisma.aiInsight.update({
            where: { id },
            data: {
              ...draftContent(draft),
              status: 'ACTIVE',
              firstSeenAt: now,
              lastSeenAt: now,
              resolvedAt: null,
              dismissedAt: null,
              snoozedUntil: null,
            },
          }),
        ),
        ...(plan.resolveIds.length > 0
          ? [
              prisma.aiInsight.updateMany({
                where: { id: { in: plan.resolveIds }, status: 'ACTIVE' },
                data: { status: 'RESOLVED', resolvedAt: now },
              }),
            ]
          : []),
      ])
      return ok({
        created: plan.create.length,
        refreshed: plan.refresh.length,
        reopened: plan.reopen.length,
        resolved: plan.resolveIds.length,
      })
    } catch (error) {
      return err(dbError('Failed to apply AI insight changes', error))
    }
  },

  /** Workspace switched the proactive AI (or Steel AI) off. */
  async resolveAllActive(
    workspaceId: string,
    now: Date,
  ): Promise<Result<number>> {
    try {
      const { count } = await prisma.aiInsight.updateMany({
        where: { workspaceId, status: 'ACTIVE' },
        data: { status: 'RESOLVED', resolvedAt: now },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to resolve AI insights', error))
    }
  },

  /** Retention: resolved episodes older than `cutoff` are deleted. */
  async deleteResolvedBefore(cutoff: Date): Promise<Result<number>> {
    try {
      const { count } = await prisma.aiInsight.deleteMany({
        where: { status: 'RESOLVED', resolvedAt: { lt: cutoff } },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to prune resolved AI insights', error))
    }
  },
}
