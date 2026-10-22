import { Prisma, type WhatsAppSlaCycle } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Which target of a cycle a scan / claim is about. */
export type WhatsAppSlaTargetKind = 'firstResponse' | 'resolution'
export type WhatsAppSlaTransition = 'warn' | 'breach'

const scanInclude = {
  conversation: {
    select: {
      id: true,
      workspaceId: true,
      assignedUserId: true,
      teamId: true,
      status: true,
      deletedAt: true,
      contact: { select: { name: true, waId: true } },
      team: { select: { name: true } },
    },
  },
} satisfies Prisma.WhatsAppSlaCycleInclude

export type WhatsAppSlaCycleForScan = Prisma.WhatsAppSlaCycleGetPayload<{
  include: typeof scanInclude
}>

const openInclude = {
  conversation: {
    select: { id: true, assignedUserId: true, teamId: true },
  },
} satisfies Prisma.WhatsAppSlaCycleInclude

export type WhatsAppSlaOpenCycle = Prisma.WhatsAppSlaCycleGetPayload<{
  include: typeof openInclude
}>

export type WhatsAppSlaReportRow = Pick<
  WhatsAppSlaCycle,
  | 'teamId'
  | 'agentUserId'
  | 'startedAt'
  | 'firstResponseDueAt'
  | 'firstResponseAt'
  | 'firstResponseSeconds'
  | 'resolutionDueAt'
  | 'resolvedAt'
  | 'firstResponseBreachedAt'
  | 'resolutionBreachedAt'
>

/** Cap on the cycles read by one report (the period filter keeps it small). */
export const WHATSAPP_SLA_REPORT_ROW_LIMIT = 50_000

function whereDue(
  kind: WhatsAppSlaTargetKind,
  transition: WhatsAppSlaTransition,
  now: Date,
): Prisma.WhatsAppSlaCycleWhereInput {
  const open = { resolvedAt: null }
  if (kind === 'firstResponse') {
    return transition === 'breach'
      ? {
          ...open,
          firstResponseAt: null,
          firstResponseBreachedAt: null,
          firstResponseDueAt: { lte: now },
        }
      : {
          ...open,
          firstResponseAt: null,
          firstResponseWarnedAt: null,
          firstResponseBreachedAt: null,
          firstResponseWarnAt: { lte: now },
          firstResponseDueAt: { gt: now },
        }
  }
  return transition === 'breach'
    ? {
        ...open,
        resolutionBreachedAt: null,
        resolutionDueAt: { lte: now },
      }
    : {
        ...open,
        resolutionWarnedAt: null,
        resolutionBreachedAt: null,
        resolutionWarnAt: { lte: now },
        resolutionDueAt: { gt: now },
      }
}

export const WhatsAppSlaCycleRepository = {
  async findOpenByConversation(
    conversationId: string,
  ): Promise<Result<WhatsAppSlaCycle | null>> {
    try {
      const row = await prisma.whatsAppSlaCycle.findFirst({
        where: { conversationId, resolvedAt: null },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find open whatsapp sla cycle', error))
    }
  },

  /** Latest cycle of the conversation, open or not. */
  async findLatestByConversation(
    conversationId: string,
  ): Promise<Result<WhatsAppSlaCycle | null>> {
    try {
      const row = await prisma.whatsAppSlaCycle.findFirst({
        where: { conversationId },
        orderBy: { startedAt: 'desc' },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find whatsapp sla cycle', error))
    }
  },

  /**
   * Opens a cycle. `null` when another writer opened one for the same
   * conversation first (partial unique index) — the race is benign.
   */
  async create(
    data: Prisma.WhatsAppSlaCycleUncheckedCreateInput,
  ): Promise<Result<WhatsAppSlaCycle | null>> {
    try {
      const row = await prisma.whatsAppSlaCycle.create({ data })
      return ok(row)
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return ok(null)
      }
      return err(dbError('Failed to create whatsapp sla cycle', error))
    }
  },

  /** Records the first answer; true when this call was the one that did. */
  async recordFirstResponse(
    cycleId: string,
    data: { at: Date; seconds: number; agentUserId: string | null },
  ): Promise<Result<boolean>> {
    try {
      const result = await prisma.whatsAppSlaCycle.updateMany({
        where: { id: cycleId, resolvedAt: null, firstResponseAt: null },
        data: {
          firstResponseAt: data.at,
          firstResponseSeconds: data.seconds,
          ...(data.agentUserId ? { agentUserId: data.agentUserId } : {}),
        },
      })
      return ok(result.count > 0)
    } catch (error) {
      return err(dbError('Failed to record whatsapp sla first response', error))
    }
  },

  /** Ends the open cycle of the conversation (close). */
  async resolveOpen(
    conversationId: string,
    data: { at: Date; agentUserId: string | null },
  ): Promise<Result<number>> {
    try {
      const result = await prisma.whatsAppSlaCycle.updateMany({
        where: { conversationId, resolvedAt: null },
        data: {
          resolvedAt: data.at,
          ...(data.agentUserId ? { agentUserId: data.agentUserId } : {}),
        },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to resolve whatsapp sla cycle', error))
    }
  },

  /** Cycles with a pending warning / breach at `now`, oldest first. */
  async listDue(
    kind: WhatsAppSlaTargetKind,
    transition: WhatsAppSlaTransition,
    now: Date,
    limit: number,
  ): Promise<Result<WhatsAppSlaCycleForScan[]>> {
    try {
      const rows = await prisma.whatsAppSlaCycle.findMany({
        where: whereDue(kind, transition, now),
        include: scanInclude,
        orderBy:
          kind === 'firstResponse'
            ? { firstResponseDueAt: 'asc' }
            : { resolutionDueAt: 'asc' },
        take: limit,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list due whatsapp sla cycles', error))
    }
  },

  /**
   * Reserves the notice of a transition: the flag is written only when still
   * unset, so two workers never notify twice. true = this call reserved it.
   */
  async claim(
    cycleId: string,
    kind: WhatsAppSlaTargetKind,
    transition: WhatsAppSlaTransition,
    now: Date,
    agentUserId: string | null,
  ): Promise<Result<boolean>> {
    try {
      const where = { id: cycleId, ...whereDue(kind, transition, now) }
      const flag =
        kind === 'firstResponse'
          ? transition === 'warn'
            ? { firstResponseWarnedAt: now }
            : { firstResponseBreachedAt: now, firstResponseWarnedAt: now }
          : transition === 'warn'
            ? { resolutionWarnedAt: now }
            : { resolutionBreachedAt: now, resolutionWarnedAt: now }
      const result = await prisma.whatsAppSlaCycle.updateMany({
        where,
        data: {
          ...flag,
          ...(transition === 'breach' && agentUserId ? { agentUserId } : {}),
        },
      })
      return ok(result.count > 0)
    } catch (error) {
      return err(dbError('Failed to claim whatsapp sla notice', error))
    }
  },

  /** Open cycles of the workspace with the fields the visibility rule needs. */
  async listOpenByWorkspace(
    workspaceId: string,
  ): Promise<Result<WhatsAppSlaOpenCycle[]>> {
    try {
      const rows = await prisma.whatsAppSlaCycle.findMany({
        where: { workspaceId, resolvedAt: null },
        include: openInclude,
        orderBy: { startedAt: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list open whatsapp sla cycles', error))
    }
  },

  async listForReport(input: {
    workspaceId: string
    from: Date
    to: Date
    teamId?: string
  }): Promise<Result<WhatsAppSlaReportRow[]>> {
    try {
      const rows = await prisma.whatsAppSlaCycle.findMany({
        where: {
          workspaceId: input.workspaceId,
          startedAt: { gte: input.from, lt: input.to },
          ...(input.teamId ? { teamId: input.teamId } : {}),
        },
        select: {
          teamId: true,
          agentUserId: true,
          startedAt: true,
          firstResponseDueAt: true,
          firstResponseAt: true,
          firstResponseSeconds: true,
          resolutionDueAt: true,
          resolvedAt: true,
          firstResponseBreachedAt: true,
          resolutionBreachedAt: true,
        },
        orderBy: { startedAt: 'asc' },
        take: WHATSAPP_SLA_REPORT_ROW_LIMIT,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list whatsapp sla cycles', error))
    }
  },
}
