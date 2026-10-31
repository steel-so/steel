import type { Prisma } from '@prisma/client'
import { sdMaintenanceNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const MAINTENANCE_INCLUDE = {
  pages: {
    include: { page: { select: { id: true, name: true, slug: true } } },
  },
} satisfies Prisma.SdStatusMaintenanceInclude

export type SdStatusMaintenanceRow = Prisma.SdStatusMaintenanceGetPayload<{
  include: typeof MAINTENANCE_INCLUDE
}>

export interface SdStatusMaintenanceInput {
  title: string
  description: string | null
  startsAt: Date
  endsAt: Date
  suppressMonitoring: boolean
  configItemIds: string[]
  notifySubscribers: boolean
}

export type SdMaintenanceNoticeKind = 'scheduled' | 'canceled'

/**
 * Scheduled maintenance windows of the status pages. Notices are claimed
 * (`announcedAt` / `canceledNoticeAt`) with a conditional update before the
 * delivery job sends anything, so a retry never repeats them.
 */
export const SdStatusMaintenanceRepository = {
  async create(
    workspaceId: string,
    input: SdStatusMaintenanceInput & {
      pageIds: string[]
      createdById: string
    },
  ): Promise<Result<SdStatusMaintenanceRow>> {
    const { pageIds, ...data } = input
    try {
      return ok(
        await prisma.sdStatusMaintenance.create({
          data: {
            ...data,
            workspaceId,
            pages: {
              create: pageIds.map((pageId) => ({ pageId, workspaceId })),
            },
          },
          include: MAINTENANCE_INCLUDE,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to create status maintenance', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SdStatusMaintenanceRow>> {
    try {
      const row = await prisma.sdStatusMaintenance.findFirst({
        where: { id, workspaceId },
        include: MAINTENANCE_INCLUDE,
      })
      return row ? ok(row) : err(sdMaintenanceNotFound())
    } catch (error) {
      return err(dbError('Failed to find status maintenance', error))
    }
  },

  /** By id only (delivery job: it has no session or workspace at hand). */
  async findByIdAny(
    id: string,
  ): Promise<Result<SdStatusMaintenanceRow | null>> {
    try {
      return ok(
        await prisma.sdStatusMaintenance.findUnique({
          where: { id },
          include: MAINTENANCE_INCLUDE,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find status maintenance', error))
    }
  },

  /** Windows that end after `since`: upcoming, running and the recent past. */
  async list(
    workspaceId: string,
    since: Date,
  ): Promise<Result<SdStatusMaintenanceRow[]>> {
    try {
      return ok(
        await prisma.sdStatusMaintenance.findMany({
          where: { workspaceId, endsAt: { gte: since } },
          orderBy: { startsAt: 'asc' },
          include: MAINTENANCE_INCLUDE,
          take: 200,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list status maintenances', error))
    }
  },

  async update(
    id: string,
    workspaceId: string,
    data: Partial<SdStatusMaintenanceInput> & {
      pageIds?: string[]
      resetAnnouncement?: boolean
    },
  ): Promise<Result<SdStatusMaintenanceRow>> {
    const { pageIds, resetAnnouncement, ...fields } = data
    try {
      const updated = await prisma.sdStatusMaintenance.updateMany({
        where: { id, workspaceId },
        data: {
          ...fields,
          ...(resetAnnouncement ? { announcedAt: null } : {}),
        },
      })
      if (updated.count === 0) return err(sdMaintenanceNotFound())
      if (pageIds) {
        await prisma.$transaction([
          prisma.sdStatusMaintenancePage.deleteMany({
            where: { maintenanceId: id },
          }),
          prisma.sdStatusMaintenancePage.createMany({
            data: pageIds.map((pageId) => ({
              maintenanceId: id,
              pageId,
              workspaceId,
            })),
          }),
        ])
      }
      return SdStatusMaintenanceRepository.findById(id, workspaceId)
    } catch (error) {
      return err(dbError('Failed to update status maintenance', error))
    }
  },

  async cancel(
    id: string,
    workspaceId: string,
    at: Date,
  ): Promise<Result<SdStatusMaintenanceRow>> {
    try {
      const updated = await prisma.sdStatusMaintenance.updateMany({
        where: { id, workspaceId, canceledAt: null },
        data: { canceledAt: at },
      })
      if (updated.count === 0) return err(sdMaintenanceNotFound())
      return SdStatusMaintenanceRepository.findById(id, workspaceId)
    } catch (error) {
      return err(dbError('Failed to cancel status maintenance', error))
    }
  },

  /**
   * Window running at `now` that suppresses the tickets of alerts about this
   * CMDB item, if any.
   */
  async findSuppressing(
    workspaceId: string,
    configItemId: string,
    now: Date,
  ): Promise<Result<{ id: string; title: string } | null>> {
    try {
      const row = await prisma.sdStatusMaintenance.findFirst({
        where: {
          workspaceId,
          suppressMonitoring: true,
          canceledAt: null,
          startsAt: { lte: now },
          endsAt: { gt: now },
          configItemIds: { has: configItemId },
        },
        select: { id: true, title: true },
        orderBy: { endsAt: 'desc' },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find suppressing maintenance', error))
    }
  },

  /** Public view: not canceled, not over, starting within `until`. */
  async listForPage(
    pageId: string,
    now: Date,
    until: Date,
  ): Promise<Result<SdStatusMaintenanceRow[]>> {
    try {
      return ok(
        await prisma.sdStatusMaintenance.findMany({
          where: {
            pages: { some: { pageId } },
            canceledAt: null,
            endsAt: { gt: now },
            startsAt: { lte: until },
          },
          orderBy: { startsAt: 'asc' },
          include: MAINTENANCE_INCLUDE,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list page maintenances', error))
    }
  },

  /** True when this call won the right to send the notice. */
  async claimNotice(
    id: string,
    kind: SdMaintenanceNoticeKind,
    at: Date,
  ): Promise<Result<boolean>> {
    try {
      const result = await prisma.sdStatusMaintenance.updateMany({
        where:
          kind === 'scheduled'
            ? { id, announcedAt: null, canceledAt: null }
            : { id, canceledAt: { not: null }, canceledNoticeAt: null },
        data:
          kind === 'scheduled' ? { announcedAt: at } : { canceledNoticeAt: at },
      })
      return ok(result.count > 0)
    } catch (error) {
      return err(dbError('Failed to claim maintenance notice', error))
    }
  },

  async finishNotice(
    id: string,
    counts: { total: number; sent: number; failed: number },
  ): Promise<Result<true>> {
    try {
      await prisma.sdStatusMaintenance.update({
        where: { id },
        data: {
          notifyTotal: counts.total,
          notifySent: counts.sent,
          notifyFailed: counts.failed,
        },
      })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to save maintenance notice counts', error))
    }
  },

  /** CMDB items of the workspace among `ids` (to validate the window). */
  async findConfigItemNames(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<Map<string, string>>> {
    if (ids.length === 0) return ok(new Map())
    try {
      const rows = await prisma.sdConfigItem.findMany({
        where: { workspaceId, id: { in: ids }, deletedAt: null },
        select: { id: true, name: true },
      })
      return ok(new Map(rows.map((r) => [r.id, r.name])))
    } catch (error) {
      return err(dbError('Failed to load config item names', error))
    }
  },
}
