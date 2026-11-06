import type { Prisma, WhatsAppConversationEvent } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const eventInclude = {
  actorUser: { select: { id: true, name: true } },
} satisfies Prisma.WhatsAppConversationEventInclude

export type WhatsAppConversationEventWithActor =
  Prisma.WhatsAppConversationEventGetPayload<{ include: typeof eventInclude }>

export const WhatsAppConversationEventRepository = {
  async create(
    data: Prisma.WhatsAppConversationEventUncheckedCreateInput,
  ): Promise<Result<WhatsAppConversationEvent>> {
    try {
      const event = await prisma.whatsAppConversationEvent.create({ data })
      return ok(event)
    } catch (error) {
      return err(dbError('Failed to create whatsapp conversation event', error))
    }
  },

  /** Source of the most recent CLOSED event (`null` = never closed). */
  async latestCloseSource(
    conversationId: string,
  ): Promise<Result<WhatsAppConversationEvent['source'] | null>> {
    try {
      const event = await prisma.whatsAppConversationEvent.findFirst({
        where: { conversationId, kind: 'CLOSED' },
        orderBy: { createdAt: 'desc' },
        select: { source: true },
      })
      return ok(event?.source ?? null)
    } catch (error) {
      return err(
        dbError('Failed to read the last close of a conversation', error),
      )
    }
  },

  async listByConversation(
    conversationId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppConversationEventWithActor[]>> {
    try {
      const events = await prisma.whatsAppConversationEvent.findMany({
        where: { conversationId, workspaceId },
        include: eventInclude,
        orderBy: { createdAt: 'asc' },
      })
      return ok(events)
    } catch (error) {
      return err(dbError('Failed to list whatsapp conversation events', error))
    }
  },
}
