import type {
  Prisma,
  WhatsAppChatbot,
  WhatsAppChatbotStatus,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const WhatsAppChatbotRepository = {
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<WhatsAppChatbot[]>> {
    try {
      const bots = await prisma.whatsAppChatbot.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
      })
      return ok(bots)
    } catch (error) {
      return err(dbError('Failed to list whatsapp chatbots', error))
    }
  },

  async count(workspaceId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.whatsAppChatbot.count({ where: { workspaceId } }))
    } catch (error) {
      return err(dbError('Failed to count whatsapp chatbots', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppChatbot | null>> {
    try {
      return ok(
        await prisma.whatsAppChatbot.findFirst({ where: { id, workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp chatbot', error))
    }
  },

  /** Published, ACTIVE bots that may answer on this connection. */
  async listRunnable(
    workspaceId: string,
    connectionId: string,
  ): Promise<Result<WhatsAppChatbot[]>> {
    try {
      const bots = await prisma.whatsAppChatbot.findMany({
        where: {
          workspaceId,
          status: 'ACTIVE',
          publishedVersion: { gt: 0 },
          OR: [{ connectionId: null }, { connectionId }],
        },
        // A bot bound to a connection wins over a workspace-wide one.
        orderBy: [
          { connectionId: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'asc' },
        ],
      })
      return ok(bots)
    } catch (error) {
      return err(dbError('Failed to list runnable whatsapp chatbots', error))
    }
  },

  async create(data: {
    workspaceId: string
    name: string
    description?: string
    triggerKind: WhatsAppChatbot['triggerKind']
    keywords: string[]
    connectionId?: string | null
    sessionTtlMinutes: number
    draft: Prisma.InputJsonValue
    createdByUserId: string
  }): Promise<Result<WhatsAppChatbot>> {
    try {
      return ok(await prisma.whatsAppChatbot.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create whatsapp chatbot', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppChatbotUncheckedUpdateInput,
  ): Promise<Result<WhatsAppChatbot>> {
    try {
      return ok(await prisma.whatsAppChatbot.update({ where: { id }, data }))
    } catch (error) {
      return err(dbError('Failed to update whatsapp chatbot', error))
    }
  },

  async setStatus(
    id: string,
    status: WhatsAppChatbotStatus,
  ): Promise<Result<WhatsAppChatbot>> {
    return WhatsAppChatbotRepository.update(id, { status })
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.whatsAppChatbot.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete whatsapp chatbot', error))
    }
  },

  /** Number of sessions per bot and status since `since`. */
  async sessionCounts(
    workspaceId: string,
    since: Date,
  ): Promise<
    Result<Array<{ chatbotId: string; status: string; count: number }>>
  > {
    try {
      const rows = await prisma.whatsAppChatbotSession.groupBy({
        by: ['chatbotId', 'status'],
        where: { workspaceId, startedAt: { gte: since } },
        _count: { _all: true },
      })
      return ok(
        rows.map((row) => ({
          chatbotId: row.chatbotId,
          status: row.status,
          count: row._count._all,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to count whatsapp chatbot sessions', error))
    }
  },
}
