import type {
  Prisma,
  SdIncidentLinkSource,
  SdMajorIncidentImpact,
  SdMajorIncidentStatus,
} from '@prisma/client'
import { sdMajorIncidentNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import { SD_USER_SUMMARY_SELECT } from './sd-ticket.repository'

const TICKET_BRIEF = {
  select: { id: true, number: true, type: true, title: true },
} as const

const INCIDENT_INCLUDE = {
  ticket: TICKET_BRIEF,
  updates: { orderBy: { createdAt: 'asc' } },
  links: {
    orderBy: { linkedAt: 'asc' },
    include: {
      ticket: {
        select: {
          id: true,
          number: true,
          type: true,
          title: true,
          phase: { select: { name: true, category: true } },
        },
      },
    },
  },
  pages: {
    include: { page: { select: { id: true, name: true, slug: true } } },
  },
} satisfies Prisma.SdMajorIncidentInclude

const SUMMARY_INCLUDE = {
  ticket: TICKET_BRIEF,
  _count: { select: { links: true, pages: true } },
} satisfies Prisma.SdMajorIncidentInclude

export type SdMajorIncidentRow = Prisma.SdMajorIncidentGetPayload<{
  include: typeof INCIDENT_INCLUDE
}>
export type SdMajorIncidentSummaryRow = Prisma.SdMajorIncidentGetPayload<{
  include: typeof SUMMARY_INCLUDE
}>
export type SdMajorIncidentUpdateRow = SdMajorIncidentRow['updates'][number]

export interface SdMajorIncidentCreateInput {
  workspaceId: string
  ticketId: string
  title: string
  summary: string | null
  impact: SdMajorIncidentImpact
  commanderId: string | null
  declaredById: string
  pageIds: string[]
  children: { ticketId: string; source: SdIncidentLinkSource }[]
  firstUpdate: { message: string; publish: boolean }
}

export interface SdMajorIncidentUpdateInput {
  status: SdMajorIncidentStatus
  message: string
  publish: boolean
  authorId: string
  impact?: SdMajorIncidentImpact
}

export interface SdMajorIncidentResolveInput {
  message: string
  publish: boolean
  resolution: string | null
  resolvedById: string
}

export interface SdMajorIncidentPatch {
  title?: string
  summary?: string | null
  impact?: SdMajorIncidentImpact
  commanderId?: string | null
  pageIds?: string[]
}

export interface SdIncidentRelatedQuery {
  workspaceId: string
  excludeTicketIds: string[]
  since: Date
  categoryId: string | null
  configItemId: string | null
  customerId: string | null
  limit: number
}

export const SdMajorIncidentRepository = {
  async create(
    input: SdMajorIncidentCreateInput,
  ): Promise<Result<SdMajorIncidentRow>> {
    try {
      const row = await prisma.sdMajorIncident.create({
        data: {
          workspaceId: input.workspaceId,
          ticketId: input.ticketId,
          title: input.title,
          summary: input.summary,
          impact: input.impact,
          commanderId: input.commanderId,
          declaredById: input.declaredById,
          pages: {
            create: input.pageIds.map((pageId) => ({
              pageId,
              workspaceId: input.workspaceId,
            })),
          },
          links: {
            create: input.children.map((child) => ({
              ticketId: child.ticketId,
              workspaceId: input.workspaceId,
              source: child.source,
              linkedById: input.declaredById,
            })),
          },
          updates: {
            create: {
              workspaceId: input.workspaceId,
              status: 'INVESTIGATING',
              message: input.firstUpdate.message,
              publish: input.firstUpdate.publish,
              authorId: input.declaredById,
            },
          },
        },
        include: INCIDENT_INCLUDE,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to create ServiceDesk major incident', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SdMajorIncidentRow>> {
    try {
      const row = await prisma.sdMajorIncident.findFirst({
        where: { id, workspaceId },
        include: INCIDENT_INCLUDE,
      })
      return row ? ok(row) : err(sdMajorIncidentNotFound())
    } catch (error) {
      return err(dbError('Failed to find ServiceDesk major incident', error))
    }
  },

  async findActiveByTicket(
    ticketId: string,
  ): Promise<Result<SdMajorIncidentSummaryRow | null>> {
    try {
      const row = await prisma.sdMajorIncident.findFirst({
        where: { ticketId, status: { not: 'RESOLVED' } },
        include: SUMMARY_INCLUDE,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find active major incident', error))
    }
  },

  async list(params: {
    workspaceId: string
    filter: 'ACTIVE' | 'RESOLVED' | 'ALL'
    limit: number
  }): Promise<Result<SdMajorIncidentSummaryRow[]>> {
    const status: Prisma.SdMajorIncidentWhereInput =
      params.filter === 'ACTIVE'
        ? { status: { not: 'RESOLVED' } }
        : params.filter === 'RESOLVED'
          ? { status: 'RESOLVED' }
          : {}
    try {
      const rows = await prisma.sdMajorIncident.findMany({
        where: { workspaceId: params.workspaceId, ...status },
        orderBy: { declaredAt: 'desc' },
        take: params.limit,
        include: SUMMARY_INCLUDE,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list ServiceDesk major incidents', error))
    }
  },

  /** Incidents the ticket is the master of (newest first) or a child of. */
  async listForTicket(ticketId: string): Promise<
    Result<{
      master: SdMajorIncidentSummaryRow[]
      child: SdMajorIncidentSummaryRow[]
    }>
  > {
    try {
      const [master, child] = await Promise.all([
        prisma.sdMajorIncident.findMany({
          where: { ticketId },
          orderBy: { declaredAt: 'desc' },
          include: SUMMARY_INCLUDE,
        }),
        prisma.sdMajorIncident.findMany({
          where: { links: { some: { ticketId } } },
          orderBy: { declaredAt: 'desc' },
          include: SUMMARY_INCLUDE,
        }),
      ])
      return ok({ master, child })
    } catch (error) {
      return err(dbError('Failed to list ticket major incidents', error))
    }
  },

  async update(
    id: string,
    workspaceId: string,
    patch: SdMajorIncidentPatch,
  ): Promise<Result<SdMajorIncidentRow>> {
    try {
      await prisma.$transaction(async (tx) => {
        const { pageIds, ...fields } = patch
        await tx.sdMajorIncident.update({ where: { id }, data: fields })
        if (pageIds) {
          await tx.sdMajorIncidentPage.deleteMany({
            where: { incidentId: id, pageId: { notIn: pageIds } },
          })
          await tx.sdMajorIncidentPage.createMany({
            data: pageIds.map((pageId) => ({
              incidentId: id,
              pageId,
              workspaceId,
            })),
            skipDuplicates: true,
          })
        }
      })
      return SdMajorIncidentRepository.findById(id, workspaceId)
    } catch (error) {
      return err(dbError('Failed to update ServiceDesk major incident', error))
    }
  },

  /** Appends a timeline entry and moves the incident to its status/impact. */
  async addUpdate(
    incidentId: string,
    workspaceId: string,
    input: SdMajorIncidentUpdateInput,
  ): Promise<Result<SdMajorIncidentUpdateRow>> {
    try {
      const row = await prisma.$transaction(async (tx) => {
        await tx.sdMajorIncident.update({
          where: { id: incidentId },
          data: {
            status: input.status,
            ...(input.impact ? { impact: input.impact } : {}),
          },
        })
        return tx.sdMajorIncidentUpdate.create({
          data: {
            incidentId,
            workspaceId,
            status: input.status,
            message: input.message,
            publish: input.publish,
            authorId: input.authorId,
          },
        })
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to add major incident update', error))
    }
  },

  async resolve(
    incidentId: string,
    workspaceId: string,
    input: SdMajorIncidentResolveInput,
  ): Promise<Result<SdMajorIncidentUpdateRow>> {
    try {
      const row = await prisma.$transaction(async (tx) => {
        await tx.sdMajorIncident.update({
          where: { id: incidentId },
          data: {
            status: 'RESOLVED',
            resolvedAt: new Date(),
            resolvedById: input.resolvedById,
            resolution: input.resolution,
          },
        })
        return tx.sdMajorIncidentUpdate.create({
          data: {
            incidentId,
            workspaceId,
            status: 'RESOLVED',
            message: input.message,
            publish: input.publish,
            authorId: input.resolvedById,
          },
        })
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to resolve ServiceDesk major incident', error))
    }
  },

  async setSwarm(id: string, swarmId: string): Promise<Result<true>> {
    try {
      await prisma.sdMajorIncident.update({
        where: { id },
        data: { swarmId },
      })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to set major incident war room', error))
    }
  },

  /** Ticket ids already linked to the incident. */
  async linkedTicketIds(incidentId: string): Promise<Result<string[]>> {
    try {
      const rows = await prisma.sdMajorIncidentTicket.findMany({
        where: { incidentId },
        select: { ticketId: true },
      })
      return ok(rows.map((r) => r.ticketId))
    } catch (error) {
      return err(dbError('Failed to list major incident children', error))
    }
  },

  async linkTickets(
    incidentId: string,
    workspaceId: string,
    entries: { ticketId: string; source: SdIncidentLinkSource }[],
    linkedById: string | null,
  ): Promise<Result<number>> {
    if (entries.length === 0) return ok(0)
    try {
      const result = await prisma.sdMajorIncidentTicket.createMany({
        data: entries.map((entry) => ({
          incidentId,
          workspaceId,
          ticketId: entry.ticketId,
          source: entry.source,
          linkedById,
        })),
        skipDuplicates: true,
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to link tickets to major incident', error))
    }
  },

  async unlinkTicket(
    incidentId: string,
    ticketId: string,
  ): Promise<Result<boolean>> {
    try {
      const result = await prisma.sdMajorIncidentTicket.deleteMany({
        where: { incidentId, ticketId },
      })
      return ok(result.count > 0)
    } catch (error) {
      return err(dbError('Failed to unlink ticket from major incident', error))
    }
  },

  /** Open incident tickets that look related to the master (not yet linked). */
  async findRelatedTickets(query: SdIncidentRelatedQuery): Promise<
    Result<
      {
        id: string
        number: number
        title: string
        createdAt: Date
        categoryId: string | null
        configItemId: string | null
        customerId: string | null
      }[]
    >
  > {
    const or: Prisma.SdTicketWhereInput[] = []
    if (query.categoryId) or.push({ categoryId: query.categoryId })
    if (query.configItemId) or.push({ configItemId: query.configItemId })
    if (query.customerId) or.push({ customerId: query.customerId })
    if (or.length === 0) return ok([])
    try {
      const rows = await prisma.sdTicket.findMany({
        where: {
          workspaceId: query.workspaceId,
          type: 'INCIDENT',
          deletedAt: null,
          id: { notIn: query.excludeTicketIds },
          createdAt: { gte: query.since },
          phase: { category: { in: ['NEW', 'IN_PROGRESS', 'WAITING'] } },
          OR: or,
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        select: {
          id: true,
          number: true,
          title: true,
          createdAt: true,
          categoryId: true,
          configItemId: true,
          customerId: true,
        },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to find related incident tickets', error))
    }
  },

  /** The active incident a ticket belongs to as a child, if any. */
  async activeIncidentOfChild(
    ticketId: string,
  ): Promise<Result<SdMajorIncidentSummaryRow | null>> {
    try {
      const row = await prisma.sdMajorIncident.findFirst({
        where: {
          status: { not: 'RESOLVED' },
          links: { some: { ticketId } },
        },
        include: SUMMARY_INCLUDE,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find incident of child ticket', error))
    }
  },

  /** Active incident whose master ticket shares a CI, category or customer. */
  async findActiveByTicketMatch(
    workspaceId: string,
    match: {
      configItemId?: string | null
      categoryId?: string | null
      customerId?: string | null
    },
  ): Promise<
    Result<{ id: string; title: string; ticketId: string } | null>
  > {
    const or: Prisma.SdTicketWhereInput[] = []
    if (match.configItemId) or.push({ configItemId: match.configItemId })
    if (match.categoryId) or.push({ categoryId: match.categoryId })
    if (match.customerId) or.push({ customerId: match.customerId })
    if (or.length === 0) return ok(null)
    try {
      const row = await prisma.sdMajorIncident.findFirst({
        where: { workspaceId, status: { not: 'RESOLVED' }, ticket: { OR: or } },
        orderBy: { declaredAt: 'desc' },
        select: { id: true, title: true, ticketId: true },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to match active major incident', error))
    }
  },

  async findUpdate(updateId: string): Promise<
    Result<{
      update: SdMajorIncidentUpdateRow
      incident: {
        id: string
        workspaceId: string
        title: string
        pageIds: string[]
      }
    } | null>
  > {
    try {
      const row = await prisma.sdMajorIncidentUpdate.findUnique({
        where: { id: updateId },
        include: {
          incident: {
            select: {
              id: true,
              workspaceId: true,
              title: true,
              pages: { select: { pageId: true } },
            },
          },
        },
      })
      if (!row) return ok(null)
      const { incident, ...update } = row
      return ok({
        update,
        incident: {
          id: incident.id,
          workspaceId: incident.workspaceId,
          title: incident.title,
          pageIds: incident.pages.map((p) => p.pageId),
        },
      })
    } catch (error) {
      return err(dbError('Failed to find major incident update', error))
    }
  },

  /** At-most-once claim of the delivery: true for the caller that won. */
  async claimNotification(updateId: string): Promise<Result<boolean>> {
    try {
      const result = await prisma.sdMajorIncidentUpdate.updateMany({
        where: { id: updateId, notifiedAt: null },
        data: { notifiedAt: new Date() },
      })
      return ok(result.count === 1)
    } catch (error) {
      return err(dbError('Failed to claim major incident notice', error))
    }
  },

  async finishNotification(
    updateId: string,
    counts: { total: number; sent: number; failed: number },
  ): Promise<Result<true>> {
    try {
      await prisma.sdMajorIncidentUpdate.update({
        where: { id: updateId },
        data: {
          notifyTotal: counts.total,
          notifySent: counts.sent,
          notifyFailed: counts.failed,
        },
      })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to store major incident notice result', error))
    }
  },

  async findUsers(
    userIds: string[],
  ): Promise<
    Result<
      Map<
        string,
        { id: string; name: string; email: string; image: string | null }
      >
    >
  > {
    const unique = Array.from(new Set(userIds.filter(Boolean)))
    if (unique.length === 0) return ok(new Map())
    try {
      const rows = await prisma.user.findMany({
        where: { id: { in: unique } },
        select: SD_USER_SUMMARY_SELECT,
      })
      return ok(new Map(rows.map((row) => [row.id, row])))
    } catch (error) {
      return err(dbError('Failed to load major incident users', error))
    }
  },

  /** Page ids of the workspace (to validate what the caller picked). */
  async countPages(
    workspaceId: string,
    pageIds: string[],
  ): Promise<Result<number>> {
    try {
      const count = await prisma.sdStatusPage.count({
        where: { workspaceId, id: { in: pageIds } },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count status pages', error))
    }
  },
}
