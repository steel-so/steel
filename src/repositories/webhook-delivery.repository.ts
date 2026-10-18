import type {
  Prisma,
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEndpoint,
} from '@prisma/client'
import { webhookDeliveryNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Delivery log of the outbound webhooks (ADR 0036). Pure Prisma. */

export type WebhookDeliveryWithEndpoint = WebhookDelivery & {
  endpoint: WebhookEndpoint
}

export interface WebhookDeliveryPage {
  items: WebhookDelivery[]
  nextCursor: string | null
}

export const WebhookDeliveryRepository = {
  async createMany(
    rows: {
      workspaceId: string
      endpointId: string
      eventId: string
      eventType: string
      body: string
    }[],
  ): Promise<Result<WebhookDelivery[]>> {
    if (rows.length === 0) return ok([])
    try {
      return ok(
        await prisma.webhookDelivery.createManyAndReturn({ data: rows }),
      )
    } catch (error) {
      return err(dbError('Failed to create webhook deliveries', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WebhookDelivery>> {
    try {
      const delivery = await prisma.webhookDelivery.findFirst({
        where: { id, workspaceId },
      })
      if (!delivery) return err(webhookDeliveryNotFound())
      return ok(delivery)
    } catch (error) {
      return err(dbError('Failed to find webhook delivery', error))
    }
  },

  /** `null` when the row is gone (retention, endpoint removed for good). */
  async findWithEndpoint(
    id: string,
  ): Promise<Result<WebhookDeliveryWithEndpoint | null>> {
    try {
      return ok(
        await prisma.webhookDelivery.findUnique({
          where: { id },
          include: { endpoint: true },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to load webhook delivery', error))
    }
  },

  /** Newest first, cursor = the last id of the previous page. */
  async list(
    workspaceId: string,
    query: {
      endpointId?: string
      status?: WebhookDeliveryStatus
      limit: number
      cursor?: string
    },
  ): Promise<Result<WebhookDeliveryPage>> {
    try {
      const where: Prisma.WebhookDeliveryWhereInput = {
        workspaceId,
        ...(query.endpointId ? { endpointId: query.endpointId } : {}),
        ...(query.status ? { status: query.status } : {}),
      }
      if (query.cursor) {
        const anchor = await prisma.webhookDelivery.findFirst({
          where: { id: query.cursor, workspaceId },
          select: { id: true },
        })
        if (!anchor) return ok({ items: [], nextCursor: null })
      }
      const rows = await prisma.webhookDelivery.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      })
      const hasMore = rows.length > query.limit
      const items = hasMore ? rows.slice(0, query.limit) : rows
      return ok({
        items,
        nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      })
    } catch (error) {
      return err(dbError('Failed to list webhook deliveries', error))
    }
  },

  async recordAttempt(
    id: string,
    data: {
      status: WebhookDeliveryStatus
      responseStatus: number | null
      responseBody: string | null
      durationMs: number | null
      error: string | null
      at: Date
    },
  ): Promise<Result<WebhookDelivery>> {
    try {
      return ok(
        await prisma.webhookDelivery.update({
          where: { id },
          data: {
            status: data.status,
            responseStatus: data.responseStatus,
            responseBody: data.responseBody,
            durationMs: data.durationMs,
            error: data.error,
            lastAttemptAt: data.at,
            attempts: { increment: 1 },
            ...(data.status === 'SUCCEEDED' ? { deliveredAt: data.at } : {}),
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to record webhook attempt', error))
    }
  },

  async markSkipped(id: string, reason: string): Promise<Result<void>> {
    try {
      await prisma.webhookDelivery.update({
        where: { id },
        data: { status: 'SKIPPED', error: reason },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to skip webhook delivery', error))
    }
  },

  /** Manual re-delivery: back to PENDING until the job runs. */
  async markPending(id: string): Promise<Result<WebhookDelivery>> {
    try {
      return ok(
        await prisma.webhookDelivery.update({
          where: { id },
          data: { status: 'PENDING', error: null },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to reset webhook delivery', error))
    }
  },
}
