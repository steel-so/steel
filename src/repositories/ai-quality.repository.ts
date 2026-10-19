import type {
  AiFeedbackRating,
  AiFeedbackSurface,
  AiUsageFeature,
  Prisma,
} from '@prisma/client'
import type { UtcRange } from '@/src/lib/ai/usage-period'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Ratings of one (surface, model, rating) group. */
export interface AiQualityGroupRow {
  surface: AiFeedbackSurface
  modelKey: string | null
  rating: AiFeedbackRating
  count: number
}

export interface AiQualityDailyRow {
  /** `YYYY-MM-DD` (UTC). */
  day: string
  up: number
  down: number
}

export interface AiQualityFeedbackRow {
  id: string
  surface: AiFeedbackSurface
  targetId: string
  variant: string
  rating: AiFeedbackRating
  reason: string | null
  comment: string | null
  modelKey: string | null
  userId: string
  userName: string | null
  userEmail: string | null
  createdAt: Date
}

export interface AiResolutionCounts {
  handled: number
  resolved: number
}

/** Where each rated answer lives (keyed by target id). */
export interface AiQualityLinkContext {
  chats: Map<string, { conversationId: string; ownerId: string }>
  agentRuns: Map<string, { agentId: string }>
  tickets: Map<string, { number: number }>
  articles: Set<string>
  whatsapp: Map<string, { conversationId: string }>
}

function where(
  workspaceId: string,
  range: UtcRange,
  userId?: string,
): Prisma.AiFeedbackWhereInput {
  return {
    workspaceId,
    createdAt: { gte: range.from, lt: range.to },
    ...(userId ? { userId } : {}),
  }
}

function toFeedbackRow(
  row: Prisma.AiFeedbackGetPayload<{
    include: { user: { select: { name: true; email: true } } }
  }>,
): AiQualityFeedbackRow {
  return {
    id: row.id,
    surface: row.surface,
    targetId: row.targetId,
    variant: row.variant,
    rating: row.rating,
    reason: row.reason,
    comment: row.comment,
    modelKey: row.modelKey,
    userId: row.userId,
    userName: row.user?.name ?? null,
    userEmail: row.user?.email ?? null,
    createdAt: row.createdAt,
  }
}

const WITH_USER = { user: { select: { name: true, email: true } } } as const

function idsOf(
  items: { surface: AiFeedbackSurface; targetId: string }[],
  ...surfaces: AiFeedbackSurface[]
): string[] {
  return [
    ...new Set(
      items
        .filter((item) => surfaces.includes(item.surface))
        .map((item) => item.targetId),
    ),
  ]
}

/**
 * Read side of the Steel AI quality panel: feedback aggregates (UTC days,
 * like the usage pages) and the "resolution without a human" counters.
 */
export const AiQualityRepository = {
  async groupRatings(
    workspaceId: string,
    range: UtcRange,
    userId?: string,
  ): Promise<Result<AiQualityGroupRow[]>> {
    try {
      const groups = await prisma.aiFeedback.groupBy({
        by: ['surface', 'modelKey', 'rating'],
        where: where(workspaceId, range, userId),
        _count: { _all: true },
      })
      return ok(
        groups.map((group) => ({
          surface: group.surface,
          modelKey: group.modelKey,
          rating: group.rating,
          count: group._count._all,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to group AI feedback', error))
    }
  },

  /** Ratings per UTC day (bounds cast like the usage ledger queries). */
  async dailyRatings(
    workspaceId: string,
    range: UtcRange,
    userId?: string,
  ): Promise<Result<AiQualityDailyRow[]>> {
    try {
      const rows = await prisma.$queryRaw<
        { day: string; up: number; down: number }[]
      >`
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
               count(*) FILTER (WHERE rating = 'UP')::int AS up,
               count(*) FILTER (WHERE rating = 'DOWN')::int AS down
        FROM ai_feedback
        WHERE workspace_id = ${workspaceId}
          AND (${userId ?? null}::text IS NULL OR user_id = ${userId ?? null})
          AND created_at >= ${range.from.toISOString()}::timestamp
          AND created_at < ${range.to.toISOString()}::timestamp
        GROUP BY 1
        ORDER BY 1`
      return ok(
        rows.map((row) => ({
          day: row.day,
          up: Number(row.up),
          down: Number(row.down),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to aggregate AI feedback per day', error))
    }
  },

  /** Most recent thumbs down of the period. */
  async latestDown(
    workspaceId: string,
    range: UtcRange,
    options: { userId?: string; take: number },
  ): Promise<Result<AiQualityFeedbackRow[]>> {
    try {
      const rows = await prisma.aiFeedback.findMany({
        where: { ...where(workspaceId, range, options.userId), rating: 'DOWN' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: options.take,
        include: WITH_USER,
      })
      return ok(rows.map(toFeedbackRow))
    } catch (error) {
      return err(dbError('Failed to list the worst AI answers', error))
    }
  },

  /** One page of feedback rows for the CSV, oldest first (id cursor). */
  async exportPage(
    workspaceId: string,
    range: UtcRange,
    options: { userId?: string; cursor?: string; take: number },
  ): Promise<Result<AiQualityFeedbackRow[]>> {
    try {
      const rows = await prisma.aiFeedback.findMany({
        where: where(workspaceId, range, options.userId),
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: options.take,
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
        include: WITH_USER,
      })
      return ok(rows.map(toFeedbackRow))
    } catch (error) {
      return err(dbError('Failed to page AI feedback rows', error))
    }
  },

  /**
   * WhatsApp conversations closed in the period where the AI replied
   * (`handled`); `resolved` = no outgoing message other than the AI's
   * (no agent, template or broadcast).
   */
  async whatsappResolution(
    workspaceId: string,
    range: UtcRange,
  ): Promise<Result<AiResolutionCounts>> {
    try {
      const rows = await prisma.$queryRaw<
        { handled: number; resolved: number }[]
      >`
        SELECT count(*)::int AS handled,
               count(*) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM whatsapp_messages h
                 WHERE h.conversation_id = c.id
                   AND h.direction = 'OUT'
                   AND h.sent_by_ai = false
               ))::int AS resolved
        FROM whatsapp_conversations c
        WHERE c.workspace_id = ${workspaceId}
          AND c.status = 'CLOSED'
          AND c.closed_at >= ${range.from.toISOString()}::timestamp
          AND c.closed_at < ${range.to.toISOString()}::timestamp
          AND EXISTS (
            SELECT 1 FROM whatsapp_messages a
            WHERE a.conversation_id = c.id AND a.sent_by_ai = true
          )`
      const row = rows[0]
      return ok({
        handled: Number(row?.handled ?? 0),
        resolved: Number(row?.resolved ?? 0),
      })
    } catch (error) {
      return err(dbError('Failed to count WhatsApp AI resolutions', error))
    }
  },

  /**
   * ServiceDesk pre-service conversations started in the period
   * (`handled`); `resolved` = closed as solved by the knowledge base.
   */
  async servicedeskResolution(
    workspaceId: string,
    range: UtcRange,
  ): Promise<Result<AiResolutionCounts>> {
    try {
      const base = {
        workspaceId,
        mode: 'PRE_SERVICE',
        createdAt: { gte: range.from, lt: range.to },
      }
      const [handled, resolved] = await Promise.all([
        prisma.sdAiConversation.count({ where: base }),
        prisma.sdAiConversation.count({
          where: { ...base, outcome: 'resolved_by_kb' },
        }),
      ])
      return ok({ handled, resolved })
    } catch (error) {
      return err(dbError('Failed to count ServiceDesk AI resolutions', error))
    }
  },

  /** AI cost (US$) of some features in the period. */
  async featureCosts(
    workspaceId: string,
    range: UtcRange,
    features: AiUsageFeature[],
  ): Promise<Result<Partial<Record<AiUsageFeature, number>>>> {
    try {
      const groups = await prisma.aiUsage.groupBy({
        by: ['feature'],
        where: {
          workspaceId,
          feature: { in: features },
          createdAt: { gte: range.from, lt: range.to },
        },
        _sum: { costUsd: true },
      })
      const costs: Partial<Record<AiUsageFeature, number>> = {}
      for (const group of groups) {
        costs[group.feature] = group._sum.costUsd?.toNumber() ?? 0
      }
      return ok(costs)
    } catch (error) {
      return err(dbError('Failed to sum AI cost per feature', error))
    }
  },

  /** Batch lookup of where each rated answer lives, for the UI links. */
  async linkContext(
    workspaceId: string,
    items: { surface: AiFeedbackSurface; targetId: string }[],
  ): Promise<Result<AiQualityLinkContext>> {
    const messageIds = idsOf(items, 'STEEL_AI_MESSAGE')
    const runIds = idsOf(items, 'STEEL_AGENT_RUN')
    const ticketIds = idsOf(items, 'SD_COPILOT', 'SD_TRIAGE')
    const articleIds = idsOf(items, 'SD_KCS_DRAFT')
    const waIds = idsOf(items, 'WHATSAPP_AUTO_REPLY')
    try {
      const [messages, runs, tickets, articles, wa] = await Promise.all([
        messageIds.length
          ? prisma.aiMessage.findMany({
              where: {
                id: { in: messageIds },
                conversation: { workspaceId, deletedAt: null },
              },
              select: {
                id: true,
                conversationId: true,
                conversation: { select: { userId: true } },
              },
            })
          : [],
        runIds.length
          ? prisma.steelAgentRun.findMany({
              where: { id: { in: runIds }, workspaceId },
              select: { id: true, agentId: true },
            })
          : [],
        ticketIds.length
          ? prisma.sdTicket.findMany({
              where: { id: { in: ticketIds }, workspaceId, deletedAt: null },
              select: { id: true, number: true },
            })
          : [],
        articleIds.length
          ? prisma.sdKbArticle.findMany({
              where: { id: { in: articleIds }, workspaceId },
              select: { id: true },
            })
          : [],
        waIds.length
          ? prisma.whatsAppMessage.findMany({
              where: { id: { in: waIds }, workspaceId },
              select: { id: true, conversationId: true },
            })
          : [],
      ])
      return ok({
        chats: new Map(
          messages.map((m) => [
            m.id,
            {
              conversationId: m.conversationId,
              ownerId: m.conversation.userId,
            },
          ]),
        ),
        agentRuns: new Map(runs.map((r) => [r.id, { agentId: r.agentId }])),
        tickets: new Map(tickets.map((t) => [t.id, { number: t.number }])),
        articles: new Set(articles.map((a) => a.id)),
        whatsapp: new Map(
          wa.map((m) => [m.id, { conversationId: m.conversationId }]),
        ),
      })
    } catch (error) {
      return err(dbError('Failed to resolve AI feedback links', error))
    }
  },
}
