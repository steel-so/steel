import type { Prisma, SdStatusChannel } from '@prisma/client'
import {
  sdStatusPageNotFound,
  sdStatusPageSlugTaken,
  sdStatusSubscriberNotFound,
} from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type SdStatusPageRow = Prisma.SdStatusPageGetPayload<object>
export type SdStatusSubscriberRow = Prisma.SdStatusSubscriberGetPayload<object>

const PUBLIC_UPDATE_SELECT = {
  status: true,
  message: true,
  createdAt: true,
} as const

/** Incidents visible on a page, with their published updates. */
const PUBLIC_INCIDENT_SELECT = {
  id: true,
  title: true,
  summary: true,
  impact: true,
  status: true,
  declaredAt: true,
  resolvedAt: true,
  updates: {
    where: { publish: true },
    orderBy: { createdAt: 'desc' },
    select: PUBLIC_UPDATE_SELECT,
  },
} satisfies Prisma.SdMajorIncidentSelect

export type SdPublicIncidentRow = Prisma.SdMajorIncidentGetPayload<{
  select: typeof PUBLIC_INCIDENT_SELECT
}>

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  )
}

export interface SdStatusPageCreateInput {
  workspaceId: string
  name: string
  slug: string
  description: string | null
  customerId: string | null
  serviceIds: string[]
  published: boolean
  allowSubscriptions: boolean
  createdById: string
}

export const SdStatusPageRepository = {
  async create(
    input: SdStatusPageCreateInput,
  ): Promise<Result<SdStatusPageRow>> {
    try {
      return ok(await prisma.sdStatusPage.create({ data: input }))
    } catch (error) {
      if (isUniqueViolation(error)) return err(sdStatusPageSlugTaken())
      return err(dbError('Failed to create ServiceDesk status page', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SdStatusPageRow>> {
    try {
      const row = await prisma.sdStatusPage.findFirst({
        where: { id, workspaceId },
      })
      return row ? ok(row) : err(sdStatusPageNotFound())
    } catch (error) {
      return err(dbError('Failed to find ServiceDesk status page', error))
    }
  },

  async findBySlug(slug: string): Promise<Result<SdStatusPageRow | null>> {
    try {
      return ok(await prisma.sdStatusPage.findUnique({ where: { slug } }))
    } catch (error) {
      return err(dbError('Failed to find status page by slug', error))
    }
  },

  async list(workspaceId: string): Promise<Result<SdStatusPageRow[]>> {
    try {
      return ok(
        await prisma.sdStatusPage.findMany({
          where: { workspaceId },
          orderBy: { name: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list ServiceDesk status pages', error))
    }
  },

  /** Pages that exist in the workspace, among `ids`. */
  async findManyByIds(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<SdStatusPageRow[]>> {
    if (ids.length === 0) return ok([])
    try {
      return ok(
        await prisma.sdStatusPage.findMany({
          where: { workspaceId, id: { in: ids } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to load status pages', error))
    }
  },

  async update(
    id: string,
    workspaceId: string,
    data: Prisma.SdStatusPageUpdateInput,
  ): Promise<Result<SdStatusPageRow>> {
    try {
      const result = await prisma.sdStatusPage.updateMany({
        where: { id, workspaceId },
        data,
      })
      if (result.count === 0) return err(sdStatusPageNotFound())
      return SdStatusPageRepository.findById(id, workspaceId)
    } catch (error) {
      return err(dbError('Failed to update ServiceDesk status page', error))
    }
  },

  async remove(id: string, workspaceId: string): Promise<Result<true>> {
    try {
      const result = await prisma.sdStatusPage.deleteMany({
        where: { id, workspaceId },
      })
      return result.count === 0 ? err(sdStatusPageNotFound()) : ok(true)
    } catch (error) {
      return err(dbError('Failed to delete ServiceDesk status page', error))
    }
  },

  /** Subscriber and active-incident counts per page. */
  async counts(
    pageIds: string[],
  ): Promise<
    Result<{ subscribers: Map<string, number>; active: Map<string, number> }>
  > {
    if (pageIds.length === 0) {
      return ok({ subscribers: new Map(), active: new Map() })
    }
    try {
      const [subscribers, active] = await Promise.all([
        prisma.sdStatusSubscriber.groupBy({
          by: ['pageId'],
          where: { pageId: { in: pageIds }, confirmedAt: { not: null } },
          _count: { _all: true },
        }),
        prisma.sdMajorIncidentPage.groupBy({
          by: ['pageId'],
          where: {
            pageId: { in: pageIds },
            incident: { status: { not: 'RESOLVED' } },
          },
          _count: { _all: true },
        }),
      ])
      return ok({
        subscribers: new Map(subscribers.map((r) => [r.pageId, r._count._all])),
        active: new Map(active.map((r) => [r.pageId, r._count._all])),
      })
    } catch (error) {
      return err(dbError('Failed to count status page figures', error))
    }
  },

  async listIncidents(
    pageId: string,
    since: Date,
  ): Promise<Result<SdPublicIncidentRow[]>> {
    try {
      const rows = await prisma.sdMajorIncident.findMany({
        where: {
          pages: { some: { pageId } },
          OR: [{ status: { not: 'RESOLVED' } }, { resolvedAt: { gte: since } }],
        },
        orderBy: { declaredAt: 'desc' },
        select: PUBLIC_INCIDENT_SELECT,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list status page incidents', error))
    }
  },

  async findNames(
    workspaceId: string,
    input: { serviceIds: string[]; customerId: string | null },
  ): Promise<
    Result<{
      services: Map<string, string>
      customers: Map<string, string>
    }>
  > {
    try {
      const [services, customers] = await Promise.all([
        input.serviceIds.length > 0
          ? prisma.sdCategory.findMany({
              where: { workspaceId, id: { in: input.serviceIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        input.customerId
          ? prisma.sdCustomer.findMany({
              where: { workspaceId, id: input.customerId },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ])
      return ok({
        services: new Map(services.map((s) => [s.id, s.name])),
        customers: new Map(customers.map((c) => [c.id, c.name])),
      })
    } catch (error) {
      return err(dbError('Failed to load status page names', error))
    }
  },

  async findWorkspaceName(workspaceId: string): Promise<Result<string | null>> {
    try {
      const row = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { name: true },
      })
      return ok(row?.name ?? null)
    } catch (error) {
      return err(dbError('Failed to load workspace name', error))
    }
  },

  // ----- Subscribers -------------------------------------------------------

  async listSubscribers(
    pageId: string,
  ): Promise<Result<SdStatusSubscriberRow[]>> {
    try {
      return ok(
        await prisma.sdStatusSubscriber.findMany({
          where: { pageId },
          orderBy: { createdAt: 'desc' },
          take: 1000,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list status subscribers', error))
    }
  },

  async findSubscriber(
    pageId: string,
    channel: SdStatusChannel,
    address: string,
  ): Promise<Result<SdStatusSubscriberRow | null>> {
    try {
      return ok(
        await prisma.sdStatusSubscriber.findUnique({
          where: { pageId_channel_address: { pageId, channel, address } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find status subscriber', error))
    }
  },

  async findSubscriberByToken(
    token: string,
  ): Promise<Result<SdStatusSubscriberRow | null>> {
    try {
      return ok(
        await prisma.sdStatusSubscriber.findUnique({ where: { token } }),
      )
    } catch (error) {
      return err(dbError('Failed to find status subscriber by token', error))
    }
  },

  async createSubscriber(input: {
    workspaceId: string
    pageId: string
    channel: SdStatusChannel
    address: string
    name: string | null
    token: string
    confirmed: boolean
    addedById: string | null
  }): Promise<Result<SdStatusSubscriberRow>> {
    const { confirmed, ...data } = input
    try {
      return ok(
        await prisma.sdStatusSubscriber.create({
          data: { ...data, confirmedAt: confirmed ? new Date() : null },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to create status subscriber', error))
    }
  },

  async confirmSubscriber(id: string): Promise<Result<SdStatusSubscriberRow>> {
    try {
      return ok(
        await prisma.sdStatusSubscriber.update({
          where: { id },
          data: { confirmedAt: new Date() },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to confirm status subscriber', error))
    }
  },

  async removeSubscriber(id: string, pageId: string): Promise<Result<true>> {
    try {
      const result = await prisma.sdStatusSubscriber.deleteMany({
        where: { id, pageId },
      })
      return result.count === 0 ? err(sdStatusSubscriberNotFound()) : ok(true)
    } catch (error) {
      return err(dbError('Failed to remove status subscriber', error))
    }
  },

  /** Confirmed subscribers of any of the pages (one row per channel/address). */
  async listConfirmedForPages(
    pageIds: string[],
    limit: number,
  ): Promise<
    Result<(SdStatusSubscriberRow & { pageName: string; pageSlug: string })[]>
  > {
    if (pageIds.length === 0) return ok([])
    try {
      const rows = await prisma.sdStatusSubscriber.findMany({
        where: { pageId: { in: pageIds }, confirmedAt: { not: null } },
        orderBy: { createdAt: 'asc' },
        take: limit * 2,
        include: { page: { select: { name: true, slug: true } } },
      })
      const seen = new Set<string>()
      const unique: (SdStatusSubscriberRow & {
        pageName: string
        pageSlug: string
      })[] = []
      for (const { page, ...row } of rows) {
        const key = `${row.channel}:${row.address}`
        if (seen.has(key)) continue
        seen.add(key)
        unique.push({ ...row, pageName: page.name, pageSlug: page.slug })
      }
      return ok(unique)
    } catch (error) {
      return err(dbError('Failed to list confirmed status subscribers', error))
    }
  },
}
