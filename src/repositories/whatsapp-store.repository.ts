import type {
  Prisma,
  WhatsAppEcomEvent,
  WhatsAppEcomEventKind,
  WhatsAppEcomEventStatus,
  WhatsAppEcomTrigger,
  WhatsAppEcomTriggerKind,
  WhatsAppStoreIntegration,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const WhatsAppStoreIntegrationRepository = {
  async list(workspaceId: string): Promise<Result<WhatsAppStoreIntegration[]>> {
    try {
      return ok(
        await prisma.whatsAppStoreIntegration.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp store integrations', error))
    }
  },

  async findById(
    id: string,
    workspaceId?: string,
  ): Promise<Result<WhatsAppStoreIntegration | null>> {
    try {
      return ok(
        await prisma.whatsAppStoreIntegration.findFirst({
          where: { id, ...(workspaceId ? { workspaceId } : {}) },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp store integration', error))
    }
  },

  async create(
    data: Prisma.WhatsAppStoreIntegrationUncheckedCreateInput,
  ): Promise<Result<WhatsAppStoreIntegration>> {
    try {
      return ok(await prisma.whatsAppStoreIntegration.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create whatsapp store integration', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppStoreIntegrationUncheckedUpdateInput,
  ): Promise<Result<WhatsAppStoreIntegration>> {
    try {
      return ok(
        await prisma.whatsAppStoreIntegration.update({ where: { id }, data }),
      )
    } catch (error) {
      return err(dbError('Failed to update whatsapp store integration', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.whatsAppStoreIntegration.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete whatsapp store integration', error))
    }
  },

  async touch(id: string, at: Date): Promise<Result<void>> {
    try {
      await prisma.whatsAppStoreIntegration.update({
        where: { id },
        data: { lastEventAt: at },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to touch whatsapp store integration', error))
    }
  },
}

export const WhatsAppEcomTriggerRepository = {
  async list(workspaceId: string): Promise<Result<WhatsAppEcomTrigger[]>> {
    try {
      return ok(
        await prisma.whatsAppEcomTrigger.findMany({
          where: { workspaceId },
          orderBy: { kind: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp ecom triggers', error))
    }
  },

  async findByKind(
    workspaceId: string,
    kind: WhatsAppEcomTriggerKind,
  ): Promise<Result<WhatsAppEcomTrigger | null>> {
    try {
      return ok(
        await prisma.whatsAppEcomTrigger.findUnique({
          where: { workspaceId_kind: { workspaceId, kind } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp ecom trigger', error))
    }
  },

  async upsert(
    workspaceId: string,
    kind: WhatsAppEcomTriggerKind,
    data: Omit<
      Prisma.WhatsAppEcomTriggerUncheckedUpdateInput,
      'workspaceId' | 'kind'
    >,
  ): Promise<Result<WhatsAppEcomTrigger>> {
    try {
      return ok(
        await prisma.whatsAppEcomTrigger.upsert({
          where: { workspaceId_kind: { workspaceId, kind } },
          create: {
            workspaceId,
            kind,
            ...(data as Prisma.WhatsAppEcomTriggerUncheckedCreateInput),
          },
          update: data,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to upsert whatsapp ecom trigger', error))
    }
  },
}

export type EcomEventWithStore = WhatsAppEcomEvent & {
  integration: WhatsAppStoreIntegration
}

export const WhatsAppEcomEventRepository = {
  /** `null` when the store already delivered this event (a webhook retry). */
  async createIfNew(
    data: Prisma.WhatsAppEcomEventUncheckedCreateInput,
  ): Promise<Result<WhatsAppEcomEvent | null>> {
    try {
      const duplicate = await prisma.whatsAppEcomEvent.findUnique({
        where: {
          integrationId_kind_externalId: {
            integrationId: data.integrationId,
            kind: data.kind,
            externalId: data.externalId,
          },
        },
        select: { id: true },
      })
      if (duplicate) return ok(null)
      return ok(await prisma.whatsAppEcomEvent.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create whatsapp ecom event', error))
    }
  },

  /** Pending events of a contact that a later purchase makes pointless. */
  async skipPending(
    workspaceId: string,
    waId: string,
    kind: WhatsAppEcomEventKind,
    reason: string,
    now: Date,
  ): Promise<Result<number>> {
    try {
      const result = await prisma.whatsAppEcomEvent.updateMany({
        where: { workspaceId, waId, kind, status: 'PENDING' },
        data: { status: 'SKIPPED', skipReason: reason, processedAt: now },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to skip whatsapp ecom events', error))
    }
  },

  /** Claims due events (`FOR UPDATE SKIP LOCKED`); stale claims return. */
  async claimDue(
    now: Date,
    staleBefore: Date,
    limit: number,
  ): Promise<Result<EcomEventWithStore[]>> {
    try {
      const claimed = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE whatsapp_ecom_events
        SET claimed_at = ${now}
        WHERE id IN (
          SELECT id FROM whatsapp_ecom_events
          WHERE status = 'PENDING'::"WhatsAppEcomEventStatus"
            AND scheduled_at <= ${now}
            AND (claimed_at IS NULL OR claimed_at < ${staleBefore})
          ORDER BY scheduled_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id`
      if (claimed.length === 0) return ok([])
      return ok(
        await prisma.whatsAppEcomEvent.findMany({
          where: { id: { in: claimed.map((row) => row.id) } },
          include: { integration: true },
          orderBy: { scheduledAt: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to claim due whatsapp ecom events', error))
    }
  },

  async finish(
    id: string,
    status: Exclude<WhatsAppEcomEventStatus, 'PENDING'>,
    detail: { skipReason?: string; providerMessageId?: string },
    now: Date,
  ): Promise<Result<void>> {
    try {
      await prisma.whatsAppEcomEvent.update({
        where: { id },
        data: {
          status,
          skipReason: detail.skipReason ?? null,
          providerMessageId: detail.providerMessageId ?? null,
          processedAt: now,
        },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to finish whatsapp ecom event', error))
    }
  },

  /** Puts a claimed event back to wait (connection down, rate limit). */
  async reschedule(id: string, scheduledAt: Date): Promise<Result<void>> {
    try {
      await prisma.whatsAppEcomEvent.update({
        where: { id },
        data: { scheduledAt, claimedAt: null },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to reschedule whatsapp ecom event', error))
    }
  },

  /** Whether an automatic message already went to the contact since `since`. */
  async hasSentSince(
    workspaceId: string,
    waId: string,
    since: Date,
  ): Promise<Result<boolean>> {
    try {
      const sent = await prisma.whatsAppEcomEvent.findFirst({
        where: {
          workspaceId,
          waId,
          status: 'SENT',
          processedAt: { gte: since },
        },
        select: { id: true },
      })
      return ok(sent !== null)
    } catch (error) {
      return err(dbError('Failed to check whatsapp ecom throttle', error))
    }
  },

  async list(
    workspaceId: string,
    take = 100,
  ): Promise<
    Result<(WhatsAppEcomEvent & { integration: { name: string } })[]>
  > {
    try {
      return ok(
        await prisma.whatsAppEcomEvent.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take,
          include: { integration: { select: { name: true } } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp ecom events', error))
    }
  },
}
