import type { WhatsAppCrmOutbound, WhatsAppMessageType } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Messages the CRM sent straight through the provider, waiting for a reply. */
export const WhatsAppCrmOutboundRepository = {
  async create(data: {
    workspaceId: string
    waId: string
    source: string
    type: WhatsAppMessageType
    text: string
    providerMessageId?: string | null
  }): Promise<Result<WhatsAppCrmOutbound>> {
    try {
      return ok(await prisma.whatsAppCrmOutbound.create({ data }))
    } catch (error) {
      return err(dbError('Failed to record CRM outbound message', error))
    }
  },

  /** Not yet filed in a conversation, oldest first. */
  async listPending(
    workspaceId: string,
    waId: string,
    since: Date,
    limit: number,
  ): Promise<Result<WhatsAppCrmOutbound[]>> {
    try {
      return ok(
        await prisma.whatsAppCrmOutbound.findMany({
          where: {
            workspaceId,
            waId,
            importedAt: null,
            sentAt: { gte: since },
          },
          orderBy: { sentAt: 'asc' },
          take: limit,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list pending CRM outbound messages', error))
    }
  },

  async markImported(ids: string[], at: Date): Promise<Result<void>> {
    try {
      await prisma.whatsAppCrmOutbound.updateMany({
        where: { id: { in: ids } },
        data: { importedAt: at },
      })
      return ok(undefined)
    } catch (error) {
      return err(
        dbError('Failed to mark CRM outbound messages imported', error),
      )
    }
  },

  /** Retention: rows older than the cutoff are of no use any more. */
  async deleteOlderThan(cutoff: Date): Promise<Result<number>> {
    try {
      const result = await prisma.whatsAppCrmOutbound.deleteMany({
        where: { sentAt: { lt: cutoff } },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to prune CRM outbound messages', error))
    }
  },
}
