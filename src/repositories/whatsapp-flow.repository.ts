import type { Prisma, WhatsAppFlow } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const WhatsAppFlowRepository = {
  async listByWorkspace(workspaceId: string): Promise<Result<WhatsAppFlow[]>> {
    try {
      return ok(
        await prisma.whatsAppFlow.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp flows', error))
    }
  },

  async count(workspaceId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.whatsAppFlow.count({ where: { workspaceId } }))
    } catch (error) {
      return err(dbError('Failed to count whatsapp flows', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppFlow | null>> {
    try {
      return ok(
        await prisma.whatsAppFlow.findFirst({ where: { id, workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp flow', error))
    }
  },

  /** Flows of the given connections that Meta knows under this flow id. */
  async listByMetaFlowId(
    metaFlowId: string,
    connectionIds: string[],
  ): Promise<Result<WhatsAppFlow[]>> {
    try {
      return ok(
        await prisma.whatsAppFlow.findMany({
          where: { metaFlowId, connectionId: { in: connectionIds } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp flows by meta id', error))
    }
  },

  /** The flow of a workspace behind a Meta flow id (template FLOW buttons). */
  async findByMetaFlowId(
    workspaceId: string,
    metaFlowId: string,
  ): Promise<Result<WhatsAppFlow | null>> {
    try {
      return ok(
        await prisma.whatsAppFlow.findFirst({
          where: { workspaceId, metaFlowId },
          orderBy: { createdAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp flow by meta id', error))
    }
  },

  async create(data: {
    workspaceId: string
    connectionId: string
    name: string
    description?: string | null
    category: string
    definition: Prisma.InputJsonValue
    bodyText: string
    ctaLabel: string
    confirmationText: string | null
    crmAction: WhatsAppFlow['crmAction']
    sourceCrmFormId?: string | null
    createdByUserId: string
  }): Promise<Result<WhatsAppFlow>> {
    try {
      return ok(await prisma.whatsAppFlow.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create whatsapp flow', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppFlowUncheckedUpdateInput,
  ): Promise<Result<WhatsAppFlow>> {
    try {
      return ok(await prisma.whatsAppFlow.update({ where: { id }, data }))
    } catch (error) {
      return err(dbError('Failed to update whatsapp flow', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.whatsAppFlow.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete whatsapp flow', error))
    }
  },
}
