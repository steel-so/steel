import {
  Prisma,
  type WhatsAppChatbotSession,
  type WhatsAppChatbotSessionStatus,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const withContact = {
  conversation: {
    select: { contact: { select: { name: true, waId: true } } },
  },
} satisfies Prisma.WhatsAppChatbotSessionInclude

export type WhatsAppChatbotSessionWithContact =
  Prisma.WhatsAppChatbotSessionGetPayload<{ include: typeof withContact }>

export const WhatsAppChatbotSessionRepository = {
  async findById(id: string): Promise<Result<WhatsAppChatbotSession | null>> {
    try {
      return ok(
        await prisma.whatsAppChatbotSession.findUnique({ where: { id } }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp chatbot session', error))
    }
  },

  async findRunningByConversation(
    conversationId: string,
  ): Promise<Result<WhatsAppChatbotSession | null>> {
    try {
      return ok(
        await prisma.whatsAppChatbotSession.findFirst({
          where: { conversationId, status: 'RUNNING' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find running chatbot session', error))
    }
  },

  /** A session already handed to a person in this conversation. */
  async hasHandedOffToHuman(conversationId: string): Promise<Result<boolean>> {
    try {
      const count = await prisma.whatsAppChatbotSession.count({
        where: { conversationId, status: 'HANDED_OFF_HUMAN' },
      })
      return ok(count > 0)
    } catch (error) {
      return err(dbError('Failed to check chatbot handoffs', error))
    }
  },

  /**
   * Creates a RUNNING session. The partial unique index turns a concurrent
   * duplicate into `ok(null)`, so the caller can just reuse the winner.
   */
  async createRunning(data: {
    workspaceId: string
    chatbotId: string
    conversationId: string
    botVersion: number
    state: Prisma.InputJsonValue
    definition: Prisma.InputJsonValue
  }): Promise<Result<WhatsAppChatbotSession | null>> {
    try {
      return ok(await prisma.whatsAppChatbotSession.create({ data }))
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return ok(null)
      }
      return err(dbError('Failed to create whatsapp chatbot session', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppChatbotSessionUncheckedUpdateInput,
  ): Promise<Result<WhatsAppChatbotSession>> {
    try {
      return ok(
        await prisma.whatsAppChatbotSession.update({ where: { id }, data }),
      )
    } catch (error) {
      return err(dbError('Failed to update whatsapp chatbot session', error))
    }
  },

  /** Ends a session only while it is still RUNNING; returns whether it did. */
  async finish(
    id: string,
    status: Exclude<WhatsAppChatbotSessionStatus, 'RUNNING'>,
    endReason: string,
    state?: Prisma.InputJsonValue,
  ): Promise<Result<boolean>> {
    try {
      const result = await prisma.whatsAppChatbotSession.updateMany({
        where: { id, status: 'RUNNING' },
        data: {
          status,
          endReason,
          endedAt: new Date(),
          lastActivityAt: new Date(),
          ...(state === undefined ? {} : { state }),
        },
      })
      return ok(result.count > 0)
    } catch (error) {
      return err(dbError('Failed to finish whatsapp chatbot session', error))
    }
  },

  async listByChatbot(input: {
    workspaceId: string
    chatbotId: string
    status?: WhatsAppChatbotSessionStatus
    limit: number
  }): Promise<Result<WhatsAppChatbotSessionWithContact[]>> {
    try {
      return ok(
        await prisma.whatsAppChatbotSession.findMany({
          where: {
            workspaceId: input.workspaceId,
            chatbotId: input.chatbotId,
            ...(input.status ? { status: input.status } : {}),
          },
          include: withContact,
          orderBy: { startedAt: 'desc' },
          take: input.limit,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp chatbot sessions', error))
    }
  },
}
