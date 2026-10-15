import type { CrmQuotaPeriod, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Read-only queries of the "Vendas" kit (ADR 0031). Pure Prisma: the
 * service turns these rows into metrics. Every query is scoped by
 * workspace and skips soft-deleted records.
 */

const PERSON = { select: { id: true, name: true, image: true } } as const

export interface SalesPersonRow {
  id: string
  name: string
  image: string | null
}

export interface WonDealRow {
  id: string
  name: string
  amount: Prisma.Decimal | null
  ownerId: string | null
  createdAt: Date
  wonAt: Date
  owner: SalesPersonRow | null
  company: { name: string } | null
}

export interface OpenDealRow {
  id: string
  name: string
  amount: Prisma.Decimal | null
  probability: number | null
  closeDate: Date | null
  updatedAt: Date
  pipelineId: string
  stage: {
    id: string
    name: string
    probability: number
    color: string | null
    position: number
  }
  owner: SalesPersonRow | null
  company: { name: string } | null
}

export interface WaitingProposalRow {
  id: string
  name: string
  status: 'SENT' | 'VIEWED'
  validUntil: Date | null
  company: { name: string } | null
  opportunity: { amount: Prisma.Decimal | null } | null
  responsible: SalesPersonRow
}

export interface SalesStageRow {
  id: string
  name: string
  pipelineId: string
  position: number
  probability: number
  color: string | null
  category: 'OPEN' | 'WON' | 'LOST'
}

/** Live deal in a live pipeline. */
function liveDeal(workspaceId: string): Prisma.CrmOpportunityWhereInput {
  return { workspaceId, deletedAt: null, pipeline: { deletedAt: null } }
}

export const CrmSalesMetricsRepository = {
  /**
   * Deals won in `[from, to)` (by `wonAt`) that still sit in a WON stage,
   * newest first.
   */
  async listWonBetween(
    workspaceId: string,
    from: Date,
    to: Date,
    options: { pipelineId?: string; limit?: number } = {},
  ): Promise<Result<WonDealRow[]>> {
    const { pipelineId, limit } = options
    try {
      const rows = await prisma.crmOpportunity.findMany({
        where: {
          ...liveDeal(workspaceId),
          ...(pipelineId ? { pipelineId } : {}),
          wonAt: { gte: from, lt: to },
          stage: { category: 'WON' },
        },
        select: {
          id: true,
          name: true,
          amount: true,
          ownerId: true,
          createdAt: true,
          wonAt: true,
          owner: PERSON,
          company: { select: { name: true } },
        },
        orderBy: { wonAt: 'desc' },
        ...(limit ? { take: limit } : {}),
      })
      return ok(rows as WonDealRow[])
    } catch (error) {
      return err(dbError('Failed to list won CRM opportunities', error))
    }
  },

  /** Open deals (stage category OPEN), optionally of one pipeline. */
  async listOpen(
    workspaceId: string,
    pipelineId?: string,
  ): Promise<Result<OpenDealRow[]>> {
    try {
      const rows = await prisma.crmOpportunity.findMany({
        where: {
          ...liveDeal(workspaceId),
          ...(pipelineId ? { pipelineId } : {}),
          stage: { category: 'OPEN' },
        },
        select: {
          id: true,
          name: true,
          amount: true,
          probability: true,
          closeDate: true,
          updatedAt: true,
          pipelineId: true,
          stage: {
            select: {
              id: true,
              name: true,
              probability: true,
              color: true,
              position: true,
            },
          },
          owner: PERSON,
          company: { select: { name: true } },
        },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list open CRM opportunities', error))
    }
  },

  /** Latest timeline activity per deal (`crm_activities.opportunity_id`). */
  async lastActivityByOpportunity(
    workspaceId: string,
    opportunityIds: string[],
  ): Promise<Result<Map<string, Date>>> {
    if (opportunityIds.length === 0) return ok(new Map())
    try {
      const groups = await prisma.crmActivity.groupBy({
        by: ['opportunityId'],
        where: { workspaceId, opportunityId: { in: opportunityIds } },
        _max: { createdAt: true },
      })
      // The `in` filter makes `opportunityId` non-null, and every group has
      // at least one row, so `_max.createdAt` is always set.
      return ok(
        new Map(
          groups.map((group) => [
            group.opportunityId as string,
            group._max.createdAt as Date,
          ]),
        ),
      )
    } catch (error) {
      return err(dbError('Failed to read CRM opportunity activity', error))
    }
  },

  async listQuotas(
    workspaceId: string,
    period: CrmQuotaPeriod,
    periodKey: string,
  ): Promise<
    Result<
      { ownerId: string; targetAmount: Prisma.Decimal; owner: SalesPersonRow }[]
    >
  > {
    try {
      const rows = await prisma.crmQuota.findMany({
        where: { workspaceId, period, periodKey },
        select: { ownerId: true, targetAmount: true, owner: PERSON },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM quotas of the period', error))
    }
  },

  /**
   * Leads created in `[from, to)` and how many of them reached the
   * opportunity stage (Oportunidade/Proposta, closed as won, or converted).
   */
  async countLeadFunnel(
    workspaceId: string,
    from: Date,
    to: Date,
  ): Promise<Result<{ total: number; converted: number }>> {
    try {
      const where: Prisma.CrmLeadWhereInput = {
        workspaceId,
        deletedAt: null,
        createdAt: { gte: from, lt: to },
      }
      const [total, converted] = await Promise.all([
        prisma.crmLead.count({ where }),
        prisma.crmLead.count({
          where: {
            ...where,
            OR: [
              { stage: { in: ['OPPORTUNITY', 'PROPOSAL'] } },
              { stage: 'CLOSED', closeResult: 'WON' },
              { convertedPersonId: { not: null } },
            ],
          },
        }),
      ])
      return ok({ total, converted })
    } catch (error) {
      return err(dbError('Failed to count CRM lead funnel', error))
    }
  },

  /** Deals created in `[from, to)` and how many of them are won today. */
  async countDealFunnel(
    workspaceId: string,
    from: Date,
    to: Date,
  ): Promise<Result<{ total: number; won: number }>> {
    try {
      const where: Prisma.CrmOpportunityWhereInput = {
        ...liveDeal(workspaceId),
        createdAt: { gte: from, lt: to },
      }
      const [total, won] = await Promise.all([
        prisma.crmOpportunity.count({ where }),
        prisma.crmOpportunity.count({
          where: { ...where, stage: { category: 'WON' } },
        }),
      ])
      return ok({ total, won })
    } catch (error) {
      return err(dbError('Failed to count CRM deal funnel', error))
    }
  },

  /** Proposals waiting for the customer (sent or viewed), by validity. */
  async listWaitingProposals(
    workspaceId: string,
  ): Promise<Result<WaitingProposalRow[]>> {
    try {
      const rows = await prisma.crmProposal.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          status: { in: ['SENT', 'VIEWED'] },
        },
        select: {
          id: true,
          name: true,
          status: true,
          validUntil: true,
          company: { select: { name: true } },
          opportunity: { select: { amount: true } },
          responsible: PERSON,
        },
        orderBy: [
          { validUntil: { sort: 'asc', nulls: 'last' } },
          { id: 'asc' },
        ],
      })
      return ok(rows as WaitingProposalRow[])
    } catch (error) {
      return err(dbError('Failed to list waiting CRM proposals', error))
    }
  },

  /** Meetings, completed tasks and contact attempts in `[from, to)`. */
  async countDayActivity(
    workspaceId: string,
    from: Date,
    to: Date,
  ): Promise<
    Result<{ meetings: number; tasksDone: number; contactAttempts: number }>
  > {
    try {
      const range = { gte: from, lt: to }
      const [events, leadMeetings, tasksDone, contactAttempts] =
        await Promise.all([
          prisma.crmCalendarEvent.count({
            where: { workspaceId, startsAt: range },
          }),
          prisma.crmLeadMeeting.count({
            where: { workspaceId, scheduledAt: range },
          }),
          prisma.crmTask.count({
            where: {
              workspaceId,
              deletedAt: null,
              status: 'DONE',
              updatedAt: range,
            },
          }),
          prisma.crmLeadContactAttempt.count({
            where: { workspaceId, occurredAt: range },
          }),
        ])
      return ok({
        meetings: events + leadMeetings,
        tasksDone,
        contactAttempts,
      })
    } catch (error) {
      return err(dbError('Failed to count CRM activity of the day', error))
    }
  },

  /** New leads in `[from, to)` grouped by source and channel. */
  async groupLeadsBySource(
    workspaceId: string,
    from: Date,
    to: Date,
  ): Promise<
    Result<{ source: string | null; channel: string | null; count: number }[]>
  > {
    try {
      const groups = await prisma.crmLead.groupBy({
        by: ['source', 'channel'],
        where: {
          workspaceId,
          deletedAt: null,
          createdAt: { gte: from, lt: to },
        },
        _count: { _all: true },
      })
      return ok(
        groups.map((group) => ({
          source: group.source,
          channel: group.channel,
          count: group._count._all,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to group CRM leads by source', error))
    }
  },

  /** The pipeline to show: `pipelineId` when live, else the default one. */
  async findPipeline(
    workspaceId: string,
    pipelineId?: string,
  ): Promise<Result<{ id: string; name: string } | null>> {
    try {
      const select = { id: true, name: true } as const
      if (pipelineId) {
        const pipeline = await prisma.crmPipeline.findFirst({
          where: { id: pipelineId, workspaceId, deletedAt: null },
          select,
        })
        if (pipeline) return ok(pipeline)
      }
      const fallback = await prisma.crmPipeline.findFirst({
        where: { workspaceId, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
        select,
      })
      return ok(fallback)
    } catch (error) {
      return err(dbError('Failed to find CRM pipeline', error))
    }
  },

  /** Stages of the live pipelines (all, or of one pipeline), in order. */
  async listStages(
    workspaceId: string,
    pipelineId?: string,
  ): Promise<Result<SalesStageRow[]>> {
    try {
      const rows = await prisma.crmPipelineStage.findMany({
        where: {
          pipeline: { workspaceId, deletedAt: null },
          ...(pipelineId ? { pipelineId } : {}),
        },
        select: {
          id: true,
          name: true,
          pipelineId: true,
          position: true,
          probability: true,
          color: true,
          category: true,
        },
        orderBy: [{ pipelineId: 'asc' }, { position: 'asc' }],
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM pipeline stages', error))
    }
  },

  async listPipelines(
    workspaceId: string,
  ): Promise<Result<{ id: string; name: string }[]>> {
    try {
      const rows = await prisma.crmPipeline.findMany({
        where: { workspaceId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { position: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM pipelines', error))
    }
  },

  /** Workspace members (name and photo), for the lookups of dashboards. */
  async listMembers(workspaceId: string): Promise<Result<SalesPersonRow[]>> {
    try {
      const rows = await prisma.membership.findMany({
        where: { workspaceId },
        select: { user: PERSON },
        orderBy: { createdAt: 'asc' },
      })
      return ok(rows.map((row) => row.user))
    } catch (error) {
      return err(dbError('Failed to list workspace members', error))
    }
  },

  /** Time zone and holidays of the workspace's default business calendar. */
  async findClock(
    workspaceId: string,
  ): Promise<Result<{ timezone: string; holidays: unknown } | null>> {
    try {
      const calendar = await prisma.sdBusinessCalendar.findFirst({
        where: { workspaceId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { timezone: true, holidays: true },
      })
      return ok(calendar)
    } catch (error) {
      return err(dbError('Failed to read the business calendar', error))
    }
  },
}
