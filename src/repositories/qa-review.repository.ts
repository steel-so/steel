import type {
  Prisma,
  QaCriterion,
  QaReview,
  QaReviewConfig,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { QaCriterionInputDTO } from '@/src/schemas/qa-review.schema'
import { dbError } from './db-error'

/** Hard cap of rows the coaching panel reads (one workspace, one period). */
export const QA_COACHING_ROW_CAP = 20_000

export type QaConfigData = Partial<
  Omit<
    Prisma.QaReviewConfigUncheckedCreateInput,
    'id' | 'workspaceId' | 'createdAt' | 'updatedAt'
  >
>

export type QaReviewUpdateData = Partial<
  Omit<
    Prisma.QaReviewUncheckedUpdateInput,
    'id' | 'workspaceId' | 'createdAt' | 'updatedAt'
  >
>

export interface QaReviewSeed {
  workspaceId: string
  subjectType: 'CONVERSATION' | 'TICKET'
  conversationId?: string | null
  ticketId?: string | null
  subjectLabel?: string | null
  agentUserId?: string | null
  agentName?: string | null
  customerName?: string | null
  subjectEndedAt?: Date | null
}

export interface QaReviewFilters {
  subjectType?: 'CONVERSATION' | 'TICKET'
  status?: 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'FAILED'
  handlerKind?: 'HUMAN' | 'BOT' | 'MIXED'
  agentUserId?: string
  lowOnly?: boolean
  from?: Date
  to?: Date
}

function filtersToWhere(
  workspaceId: string,
  filters: QaReviewFilters,
): Prisma.QaReviewWhereInput {
  const range =
    filters.from || filters.to
      ? {
          reviewedAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}
  return {
    workspaceId,
    ...(filters.subjectType ? { subjectType: filters.subjectType } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.handlerKind ? { handlerKind: filters.handlerKind } : {}),
    ...(filters.agentUserId ? { agentUserId: filters.agentUserId } : {}),
    ...(filters.lowOnly ? { lowScore: true } : {}),
    ...range,
  }
}

export const QaReviewRepository = {
  async findConfig(
    workspaceId: string,
  ): Promise<Result<QaReviewConfig | null>> {
    try {
      return ok(
        await prisma.qaReviewConfig.findUnique({ where: { workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to find QA config', error))
    }
  },

  async upsertConfig(
    workspaceId: string,
    data: QaConfigData,
  ): Promise<Result<QaReviewConfig>> {
    try {
      return ok(
        await prisma.qaReviewConfig.upsert({
          where: { workspaceId },
          create: { workspaceId, ...data },
          update: data,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to save QA config', error))
    }
  },

  async listCriteria(workspaceId: string): Promise<Result<QaCriterion[]>> {
    try {
      return ok(
        await prisma.qaCriterion.findMany({
          where: { workspaceId },
          orderBy: [{ position: 'asc' }, { key: 'asc' }],
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list QA criteria', error))
    }
  },

  /** Replaces the whole set: keys not listed are removed, the rest upserted. */
  async replaceCriteria(
    workspaceId: string,
    criteria: QaCriterionInputDTO[],
  ): Promise<Result<QaCriterion[]>> {
    try {
      await prisma.$transaction([
        prisma.qaCriterion.deleteMany({
          where: { workspaceId, key: { notIn: criteria.map((c) => c.key) } },
        }),
        ...criteria.map((criterion, position) =>
          prisma.qaCriterion.upsert({
            where: { workspaceId_key: { workspaceId, key: criterion.key } },
            create: { workspaceId, ...criterion, position },
            update: { ...criterion, position },
          }),
        ),
      ])
      return await this.listCriteria(workspaceId)
    } catch (error) {
      return err(dbError('Failed to replace QA criteria', error))
    }
  },

  /** Creates the review of a subject, or resets it to PENDING for a re-run. */
  async upsertPending(seed: QaReviewSeed): Promise<Result<QaReview>> {
    const { conversationId, ticketId, ...rest } = seed
    const reset = {
      status: 'PENDING' as const,
      skipReason: null,
      score: null,
      summary: null,
      lowScore: false,
      reviewedAt: null,
    }
    try {
      if (seed.subjectType === 'CONVERSATION' && conversationId) {
        return ok(
          await prisma.qaReview.upsert({
            where: { conversationId },
            create: { ...rest, conversationId },
            update: reset,
          }),
        )
      }
      if (seed.subjectType === 'TICKET' && ticketId) {
        return ok(
          await prisma.qaReview.upsert({
            where: { ticketId },
            create: { ...rest, ticketId },
            update: reset,
          }),
        )
      }
      return err(dbError('QA review without a subject id', null))
    } catch (error) {
      return err(dbError('Failed to schedule QA review', error))
    }
  },

  async findById(id: string): Promise<Result<QaReview | null>> {
    try {
      return ok(await prisma.qaReview.findUnique({ where: { id } }))
    } catch (error) {
      return err(dbError('Failed to find QA review', error))
    }
  },

  async findInWorkspace(
    workspaceId: string,
    id: string,
  ): Promise<Result<QaReview | null>> {
    try {
      return ok(await prisma.qaReview.findFirst({ where: { id, workspaceId } }))
    } catch (error) {
      return err(dbError('Failed to find QA review', error))
    }
  },

  async update(
    id: string,
    data: QaReviewUpdateData,
  ): Promise<Result<QaReview>> {
    try {
      return ok(await prisma.qaReview.update({ where: { id }, data }))
    } catch (error) {
      return err(dbError('Failed to update QA review', error))
    }
  },

  async list(
    workspaceId: string,
    filters: QaReviewFilters,
    page: { cursor?: string; limit: number },
  ): Promise<Result<{ items: QaReview[]; nextCursor: string | null }>> {
    try {
      const rows = await prisma.qaReview.findMany({
        where: filtersToWhere(workspaceId, filters),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: page.limit + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
      })
      const hasMore = rows.length > page.limit
      const items = hasMore ? rows.slice(0, page.limit) : rows
      return ok({
        items,
        nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      })
    } catch (error) {
      return err(dbError('Failed to list QA reviews', error))
    }
  },

  /** Completed reviews of the period, for the coaching panel. */
  async listCompleted(
    workspaceId: string,
    range: { from: Date; to: Date },
    agentUserId?: string,
  ): Promise<Result<QaReview[]>> {
    try {
      return ok(
        await prisma.qaReview.findMany({
          where: {
            workspaceId,
            status: 'COMPLETED',
            reviewedAt: { gte: range.from, lte: range.to },
            ...(agentUserId ? { agentUserId } : {}),
          },
          orderBy: { reviewedAt: 'desc' },
          take: QA_COACHING_ROW_CAP,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to read QA reviews for coaching', error))
    }
  },
}
