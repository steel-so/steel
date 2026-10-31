import type { Prisma, WhatsAppCoexistenceSync } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const WhatsAppCoexistenceRepository = {
  async create(
    data: Prisma.WhatsAppCoexistenceSyncUncheckedCreateInput,
  ): Promise<Result<WhatsAppCoexistenceSync>> {
    try {
      const sync = await prisma.whatsAppCoexistenceSync.create({ data })
      return ok(sync)
    } catch (error) {
      return err(dbError('Failed to create coexistence sync', error))
    }
  },

  async findByConnection(
    workspaceId: string,
    connectionId: string,
  ): Promise<Result<WhatsAppCoexistenceSync | null>> {
    try {
      const sync = await prisma.whatsAppCoexistenceSync.findFirst({
        where: { workspaceId, connectionId },
      })
      return ok(sync)
    } catch (error) {
      return err(dbError('Failed to find coexistence sync', error))
    }
  },

  async update(
    connectionId: string,
    data: Prisma.WhatsAppCoexistenceSyncUncheckedUpdateInput,
  ): Promise<Result<WhatsAppCoexistenceSync | null>> {
    try {
      const result = await prisma.whatsAppCoexistenceSync.updateMany({
        where: { connectionId },
        data,
      })
      if (result.count === 0) return ok(null)
      const sync = await prisma.whatsAppCoexistenceSync.findUnique({
        where: { connectionId },
      })
      return ok(sync)
    } catch (error) {
      return err(dbError('Failed to update coexistence sync', error))
    }
  },

  /**
   * Bulk insert of imported history. `providerMessageId` is unique, so a
   * chunk Meta delivers twice (or a message already received live) is skipped.
   * Returns how many rows were really created.
   */
  async createHistoryMessages(
    data: Prisma.WhatsAppMessageUncheckedCreateInput[],
  ): Promise<Result<number>> {
    try {
      const result = await prisma.whatsAppMessage.createMany({
        data,
        skipDuplicates: true,
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to import coexistence history', error))
    }
  },
}
