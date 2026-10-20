import type { Prisma, WhatsAppCloseStatus } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const WhatsAppCloseStatusRepository = {
  /** Active (non-archived) statuses, in display order. */
  async listActive(
    workspaceId: string,
  ): Promise<Result<WhatsAppCloseStatus[]>> {
    try {
      const statuses = await prisma.whatsAppCloseStatus.findMany({
        where: { workspaceId, archivedAt: null },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      })
      return ok(statuses)
    } catch (error) {
      return err(dbError('Failed to list whatsapp close statuses', error))
    }
  },

  async findActiveById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppCloseStatus | null>> {
    try {
      const status = await prisma.whatsAppCloseStatus.findFirst({
        where: { id, workspaceId, archivedAt: null },
      })
      return ok(status)
    } catch (error) {
      return err(dbError('Failed to find whatsapp close status', error))
    }
  },

  async create(
    data: Prisma.WhatsAppCloseStatusUncheckedCreateInput,
  ): Promise<Result<WhatsAppCloseStatus>> {
    try {
      const status = await prisma.whatsAppCloseStatus.create({ data })
      return ok(status)
    } catch (error) {
      return err(dbError('Failed to create whatsapp close status', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppCloseStatusUpdateInput,
  ): Promise<Result<WhatsAppCloseStatus>> {
    try {
      const status = await prisma.whatsAppCloseStatus.update({
        where: { id },
        data,
      })
      return ok(status)
    } catch (error) {
      return err(dbError('Failed to update whatsapp close status', error))
    }
  },
}
