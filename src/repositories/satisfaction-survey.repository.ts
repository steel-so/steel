import type {
  Prisma,
  SatisfactionSurvey,
  SatisfactionSurveyConfig,
  SatisfactionSurveyKind,
  SatisfactionSurveyStatus,
  SatisfactionSurveyTrigger,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Hard cap of rows a report reads (one workspace, one period). */
export const SURVEY_REPORT_ROW_CAP = 50_000

export type SurveyReportRow = Pick<
  SatisfactionSurvey,
  | 'status'
  | 'score'
  | 'assigneeUserId'
  | 'assigneeName'
  | 'teamId'
  | 'teamName'
  | 'customerKey'
  | 'customerName'
  | 'trigger'
>

export type CreateSurveyData = Omit<
  Prisma.SatisfactionSurveyUncheckedCreateInput,
  'id' | 'createdAt' | 'updatedAt'
>

export type SurveyConfigData = Partial<
  Omit<
    Prisma.SatisfactionSurveyConfigUncheckedCreateInput,
    'id' | 'workspaceId' | 'trigger' | 'createdAt' | 'updatedAt'
  >
>

export const SatisfactionSurveyRepository = {
  async listConfigs(
    workspaceId: string,
  ): Promise<Result<SatisfactionSurveyConfig[]>> {
    try {
      return ok(
        await prisma.satisfactionSurveyConfig.findMany({
          where: { workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list survey configs', error))
    }
  },

  async findConfig(
    workspaceId: string,
    trigger: SatisfactionSurveyTrigger,
  ): Promise<Result<SatisfactionSurveyConfig | null>> {
    try {
      return ok(
        await prisma.satisfactionSurveyConfig.findUnique({
          where: { workspaceId_trigger: { workspaceId, trigger } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find survey config', error))
    }
  },

  async upsertConfig(
    workspaceId: string,
    trigger: SatisfactionSurveyTrigger,
    data: SurveyConfigData,
  ): Promise<Result<SatisfactionSurveyConfig>> {
    try {
      return ok(
        await prisma.satisfactionSurveyConfig.upsert({
          where: { workspaceId_trigger: { workspaceId, trigger } },
          create: { workspaceId, trigger, ...data },
          update: data,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to save survey config', error))
    }
  },

  async create(data: CreateSurveyData): Promise<Result<SatisfactionSurvey>> {
    try {
      return ok(await prisma.satisfactionSurvey.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create survey', error))
    }
  },

  async findById(
    id: string,
    workspaceId?: string,
  ): Promise<Result<SatisfactionSurvey | null>> {
    try {
      return ok(
        await prisma.satisfactionSurvey.findFirst({
          where: { id, ...(workspaceId ? { workspaceId } : {}) },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find survey', error))
    }
  },

  async findByToken(
    token: string,
  ): Promise<Result<(SatisfactionSurvey & { workspaceName: string }) | null>> {
    try {
      const row = await prisma.satisfactionSurvey.findUnique({
        where: { token },
        include: { workspace: { select: { name: true } } },
      })
      if (!row) return ok(null)
      const { workspace, ...survey } = row
      return ok({ ...survey, workspaceName: workspace.name })
    } catch (error) {
      return err(dbError('Failed to find survey by token', error))
    }
  },

  /** Newest invitation still waiting for an answer from this phone. */
  async findOpenByPhone(
    workspaceId: string,
    phone: string,
    now: Date,
  ): Promise<Result<SatisfactionSurvey | null>> {
    try {
      return ok(
        await prisma.satisfactionSurvey.findFirst({
          where: {
            workspaceId,
            recipientPhone: phone,
            channel: 'WHATSAPP',
            status: 'SENT',
            expiresAt: { gt: now },
          },
          orderBy: { sentAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find open survey', error))
    }
  },

  /** Newest answered survey of this phone still open for a comment. */
  async findAwaitingComment(
    workspaceId: string,
    phone: string,
    since: Date,
  ): Promise<Result<SatisfactionSurvey | null>> {
    try {
      return ok(
        await prisma.satisfactionSurvey.findFirst({
          where: {
            workspaceId,
            recipientPhone: phone,
            channel: 'WHATSAPP',
            status: 'ANSWERED',
            comment: null,
            answeredAt: { gte: since },
          },
          orderBy: { answeredAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find survey awaiting comment', error))
    }
  },

  /** Was this recipient surveyed (not failed/skipped) since `since`? */
  async existsRecentForRecipient(
    workspaceId: string,
    recipient: { phone?: string | null; email?: string | null },
    since: Date,
  ): Promise<Result<boolean>> {
    const or: Prisma.SatisfactionSurveyWhereInput[] = []
    if (recipient.phone) or.push({ recipientPhone: recipient.phone })
    if (recipient.email) or.push({ recipientEmail: recipient.email })
    if (or.length === 0) return ok(false)
    try {
      const count = await prisma.satisfactionSurvey.count({
        where: {
          workspaceId,
          OR: or,
          status: { in: ['SCHEDULED', 'SENT', 'ANSWERED'] },
          createdAt: { gte: since },
        },
      })
      return ok(count > 0)
    } catch (error) {
      return err(dbError('Failed to check recent surveys', error))
    }
  },

  async existsForTicket(ticketId: string): Promise<Result<boolean>> {
    try {
      const count = await prisma.satisfactionSurvey.count({
        where: { ticketId, status: { in: ['SCHEDULED', 'SENT', 'ANSWERED'] } },
      })
      return ok(count > 0)
    } catch (error) {
      return err(dbError('Failed to check ticket surveys', error))
    }
  },

  async update(
    id: string,
    data: Prisma.SatisfactionSurveyUncheckedUpdateInput,
  ): Promise<Result<SatisfactionSurvey>> {
    try {
      return ok(await prisma.satisfactionSurvey.update({ where: { id }, data }))
    } catch (error) {
      return err(dbError('Failed to update survey', error))
    }
  },

  /**
   * Records the answer only while the survey is still unanswered (atomic in
   * the `WHERE`: two simultaneous answers do not overwrite each other).
   * `true` = written; `false` = it had been answered already.
   */
  async answer(
    id: string,
    score: number,
    answeredAt: Date,
    comment?: string,
  ): Promise<Result<boolean>> {
    try {
      const result = await prisma.satisfactionSurvey.updateMany({
        where: { id, status: { in: ['SENT', 'SCHEDULED'] }, answeredAt: null },
        data: {
          status: 'ANSWERED',
          score,
          answeredAt,
          ...(comment ? { comment } : {}),
        },
      })
      return ok(result.count === 1)
    } catch (error) {
      return err(dbError('Failed to answer survey', error))
    }
  },

  /** Adds the comment to an answered survey that has none yet. */
  async setComment(id: string, comment: string): Promise<Result<boolean>> {
    try {
      const result = await prisma.satisfactionSurvey.updateMany({
        where: { id, status: 'ANSWERED', comment: null },
        data: { comment },
      })
      return ok(result.count === 1)
    } catch (error) {
      return err(dbError('Failed to save survey comment', error))
    }
  },

  async list(
    workspaceId: string,
    filter: {
      kind?: SatisfactionSurveyKind
      status?: SatisfactionSurveyStatus
    },
    page: number,
    pageSize: number,
  ): Promise<Result<{ items: SatisfactionSurvey[]; total: number }>> {
    const where: Prisma.SatisfactionSurveyWhereInput = {
      workspaceId,
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    }
    try {
      const [items, total] = await prisma.$transaction([
        prisma.satisfactionSurvey.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.satisfactionSurvey.count({ where }),
      ])
      return ok({ items, total })
    } catch (error) {
      return err(dbError('Failed to list surveys', error))
    }
  },

  /** Sent and answered surveys of one kind in the period, for the report. */
  async reportRows(
    workspaceId: string,
    kind: SatisfactionSurveyKind,
    from: Date | null,
    to: Date | null,
  ): Promise<Result<SurveyReportRow[]>> {
    try {
      const rows = await prisma.satisfactionSurvey.findMany({
        where: {
          workspaceId,
          kind,
          status: { in: ['SENT', 'ANSWERED'] },
          ...(from || to
            ? {
                createdAt: {
                  ...(from ? { gte: from } : {}),
                  ...(to ? { lte: to } : {}),
                },
              }
            : {}),
        },
        select: {
          status: true,
          score: true,
          assigneeUserId: true,
          assigneeName: true,
          teamId: true,
          teamName: true,
          customerKey: true,
          customerName: true,
          trigger: true,
        },
        take: SURVEY_REPORT_ROW_CAP,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to read survey report rows', error))
    }
  },
}
