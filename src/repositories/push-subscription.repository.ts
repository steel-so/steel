import type { PushSubscription } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export interface PushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string | null
}

export const PushSubscriptionRepository = {
  /** Registers (or re-registers) a device; the endpoint is unique. */
  async upsert(
    userId: string,
    input: PushSubscriptionInput,
  ): Promise<Result<PushSubscription>> {
    try {
      const data = {
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
      }
      const row = await prisma.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: { endpoint: input.endpoint, ...data },
        update: data,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to save push subscription', error))
    }
  },

  async countByUser(userId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.pushSubscription.count({ where: { userId } }))
    } catch (error) {
      return err(dbError('Failed to count push subscriptions', error))
    }
  },

  async listByUsers(userIds: string[]): Promise<Result<PushSubscription[]>> {
    try {
      if (userIds.length === 0) return ok([])
      return ok(
        await prisma.pushSubscription.findMany({
          where: { userId: { in: userIds } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list push subscriptions', error))
    }
  },

  /** Removes the caller's device (never someone else's). */
  async deleteByEndpoint(
    userId: string,
    endpoint: string,
  ): Promise<Result<number>> {
    try {
      const { count } = await prisma.pushSubscription.deleteMany({
        where: { userId, endpoint },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to delete push subscription', error))
    }
  },

  /** Removes the oldest devices beyond `keep` for the user. */
  async trimToLatest(userId: string, keep: number): Promise<Result<number>> {
    try {
      const stale = await prisma.pushSubscription.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: keep,
        select: { id: true },
      })
      if (stale.length === 0) return ok(0)
      const { count } = await prisma.pushSubscription.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to trim push subscriptions', error))
    }
  },

  /** Drops expired endpoints reported by the push service (404/410). */
  async deleteByIds(ids: string[]): Promise<Result<number>> {
    try {
      if (ids.length === 0) return ok(0)
      const { count } = await prisma.pushSubscription.deleteMany({
        where: { id: { in: ids } },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to delete push subscriptions', error))
    }
  },

  async touch(ids: string[], at: Date): Promise<Result<number>> {
    try {
      if (ids.length === 0) return ok(0)
      const { count } = await prisma.pushSubscription.updateMany({
        where: { id: { in: ids } },
        data: { lastUsedAt: at },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to touch push subscriptions', error))
    }
  },
}
