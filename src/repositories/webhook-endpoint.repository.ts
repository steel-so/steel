import type { WebhookEndpoint } from '@prisma/client'
import { webhookEndpointNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { WEBHOOK_ALL_EVENTS } from '@/src/lib/webhooks/events'
import { dbError } from './db-error'

/** Outbound webhook endpoints of a workspace (ADR 0036). Pure Prisma. */

const LIVE = { deletedAt: null } as const

export const WebhookEndpointRepository = {
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<WebhookEndpoint[]>> {
    try {
      return ok(
        await prisma.webhookEndpoint.findMany({
          where: { workspaceId, ...LIVE },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list webhook endpoints', error))
    }
  },

  async countByWorkspace(workspaceId: string): Promise<Result<number>> {
    try {
      return ok(
        await prisma.webhookEndpoint.count({
          where: { workspaceId, ...LIVE },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to count webhook endpoints', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WebhookEndpoint>> {
    try {
      const endpoint = await prisma.webhookEndpoint.findFirst({
        where: { id, workspaceId, ...LIVE },
      })
      if (!endpoint) return err(webhookEndpointNotFound())
      return ok(endpoint)
    } catch (error) {
      return err(dbError('Failed to find webhook endpoint', error))
    }
  },

  /** Active endpoints subscribed to `type` (explicitly or with `*`). */
  async listSubscribed(
    workspaceId: string,
    type: string,
  ): Promise<Result<Pick<WebhookEndpoint, 'id'>[]>> {
    try {
      return ok(
        await prisma.webhookEndpoint.findMany({
          where: {
            workspaceId,
            active: true,
            ...LIVE,
            events: { hasSome: [type, WEBHOOK_ALL_EVENTS] },
          },
          select: { id: true },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list subscribed webhook endpoints', error))
    }
  },

  async create(data: {
    workspaceId: string
    url: string
    description: string | null
    events: string[]
    encryptedSecret: string
    secretHint: string
    active: boolean
    createdById: string
  }): Promise<Result<WebhookEndpoint>> {
    try {
      return ok(
        await prisma.webhookEndpoint.create({
          data: {
            ...data,
            disabledAt: data.active ? null : new Date(),
            disabledReason: data.active ? null : 'manual',
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to create webhook endpoint', error))
    }
  },

  async update(
    id: string,
    data: {
      url?: string
      description?: string | null
      events?: string[]
      active?: boolean
      disabledAt?: Date | null
      disabledReason?: string | null
      failingSince?: Date | null
      encryptedSecret?: string
      secretHint?: string
    },
  ): Promise<Result<WebhookEndpoint>> {
    try {
      return ok(await prisma.webhookEndpoint.update({ where: { id }, data }))
    } catch (error) {
      return err(dbError('Failed to update webhook endpoint', error))
    }
  },

  async softDelete(id: string): Promise<Result<void>> {
    try {
      await prisma.webhookEndpoint.update({
        where: { id },
        data: { deletedAt: new Date(), active: false },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete webhook endpoint', error))
    }
  },

  /** A 2xx: the endpoint is healthy again (auto-disable clock reset). */
  async markSuccess(id: string, at: Date): Promise<Result<void>> {
    try {
      await prisma.webhookEndpoint.update({
        where: { id },
        data: { lastSuccessAt: at, failingSince: null },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to mark webhook endpoint success', error))
    }
  },

  /**
   * A failed attempt: stamps `lastFailureAt` and starts the auto-disable
   * clock (`failingSince`) when it is not running yet.
   */
  async markFailure(id: string, at: Date): Promise<Result<WebhookEndpoint>> {
    try {
      await prisma.webhookEndpoint.updateMany({
        where: { id, failingSince: null },
        data: { failingSince: at },
      })
      return ok(
        await prisma.webhookEndpoint.update({
          where: { id },
          data: { lastFailureAt: at },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to mark webhook endpoint failure', error))
    }
  },

  /** Switches an active endpoint off; `false` when it already was. */
  async disable(
    id: string,
    at: Date,
    reason: string,
  ): Promise<Result<boolean>> {
    try {
      const { count } = await prisma.webhookEndpoint.updateMany({
        where: { id, active: true },
        data: { active: false, disabledAt: at, disabledReason: reason },
      })
      return ok(count > 0)
    } catch (error) {
      return err(dbError('Failed to disable webhook endpoint', error))
    }
  },
}
