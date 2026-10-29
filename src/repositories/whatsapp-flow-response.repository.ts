import type {
  Prisma,
  WhatsAppContact,
  WhatsAppFlowResponse,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type WhatsAppFlowResponseWithContact = WhatsAppFlowResponse & {
  contact: Pick<WhatsAppContact, 'name' | 'waId'>
}

export const WhatsAppFlowResponseRepository = {
  async create(data: {
    workspaceId: string
    flowId: string
    contactId: string
    conversationId?: string | null
    flowToken: string
    sentByUserId?: string | null
    messageId?: string | null
  }): Promise<Result<WhatsAppFlowResponse>> {
    try {
      return ok(await prisma.whatsAppFlowResponse.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create whatsapp flow response', error))
    }
  },

  async findByToken(
    workspaceId: string,
    flowToken: string,
  ): Promise<Result<WhatsAppFlowResponse | null>> {
    try {
      return ok(
        await prisma.whatsAppFlowResponse.findFirst({
          where: { workspaceId, flowToken },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp flow response', error))
    }
  },

  /** Newest flow still waiting for an answer in this conversation. */
  async findLatestOpenByConversation(
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<WhatsAppFlowResponse | null>> {
    try {
      return ok(
        await prisma.whatsAppFlowResponse.findFirst({
          where: { workspaceId, conversationId, status: 'SENT' },
          orderBy: { sentAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find open whatsapp flow response', error))
    }
  },

  /** Stores the answer once: a second reply to the same send is ignored. */
  async complete(
    id: string,
    data: {
      answers: Prisma.InputJsonValue
      conversationId?: string | null
      createdLeadId?: string | null
      createdPersonId?: string | null
      createdCompanyId?: string | null
      mappingNote?: string | null
    },
  ): Promise<Result<WhatsAppFlowResponse | null>> {
    try {
      const claimed = await prisma.whatsAppFlowResponse.updateMany({
        where: { id, status: 'SENT' },
        data: { ...data, status: 'COMPLETED', respondedAt: new Date() },
      })
      if (claimed.count === 0) return ok(null)
      return ok(
        await prisma.whatsAppFlowResponse.findUniqueOrThrow({ where: { id } }),
      )
    } catch (error) {
      return err(dbError('Failed to complete whatsapp flow response', error))
    }
  },

  async setMapping(
    id: string,
    data: {
      createdLeadId?: string | null
      createdPersonId?: string | null
      createdCompanyId?: string | null
      mappingNote?: string | null
    },
  ): Promise<Result<WhatsAppFlowResponse>> {
    try {
      return ok(
        await prisma.whatsAppFlowResponse.update({ where: { id }, data }),
      )
    } catch (error) {
      return err(dbError('Failed to update whatsapp flow response', error))
    }
  },

  async countByFlow(flowId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.whatsAppFlowResponse.count({ where: { flowId } }))
    } catch (error) {
      return err(dbError('Failed to count whatsapp flow responses', error))
    }
  },

  async listByFlow(
    workspaceId: string,
    flowId: string,
    options: { cursor?: string; limit: number },
  ): Promise<Result<WhatsAppFlowResponseWithContact[]>> {
    try {
      return ok(
        await prisma.whatsAppFlowResponse.findMany({
          where: { workspaceId, flowId },
          orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
          take: options.limit + 1,
          ...(options.cursor
            ? { cursor: { id: options.cursor }, skip: 1 }
            : {}),
          include: { contact: { select: { name: true, waId: true } } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp flow responses', error))
    }
  },

  /** Sent / completed counts per flow. */
  async countsByFlow(
    workspaceId: string,
  ): Promise<Result<Array<{ flowId: string; status: string; count: number }>>> {
    try {
      const rows = await prisma.whatsAppFlowResponse.groupBy({
        by: ['flowId', 'status'],
        where: { workspaceId },
        _count: { _all: true },
      })
      return ok(
        rows.map((row) => ({
          flowId: row.flowId,
          status: row.status,
          count: row._count._all,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to count whatsapp flow responses', error))
    }
  },
}
