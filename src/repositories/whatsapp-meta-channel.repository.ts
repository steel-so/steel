import type {
  Prisma,
  WhatsAppConnection,
  WhatsAppMetaChannelSettings,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const WhatsAppMetaChannelRepository = {
  async findSettings(
    workspaceId: string,
  ): Promise<Result<WhatsAppMetaChannelSettings | null>> {
    try {
      const settings = await prisma.whatsAppMetaChannelSettings.findUnique({
        where: { workspaceId },
      })
      return ok(settings)
    } catch (error) {
      return err(dbError('Failed to find meta channel settings', error))
    }
  },

  async upsertSettings(
    workspaceId: string,
    data: Prisma.WhatsAppMetaChannelSettingsUncheckedUpdateInput,
  ): Promise<Result<WhatsAppMetaChannelSettings>> {
    try {
      const settings = await prisma.whatsAppMetaChannelSettings.upsert({
        where: { workspaceId },
        create: {
          ...(data as Prisma.WhatsAppMetaChannelSettingsUncheckedCreateInput),
          workspaceId,
        },
        update: data,
      })
      return ok(settings)
    } catch (error) {
      return err(dbError('Failed to save meta channel settings', error))
    }
  },

  /** WhatsApp numbers of a workspace connected through Coexistence. */
  async listCoexistenceConnections(
    workspaceId: string,
  ): Promise<Result<WhatsAppConnection[]>> {
    try {
      const connections = await prisma.whatsAppConnection.findMany({
        where: { workspaceId, module: 'COMMUNICATION', coexistence: true },
        orderBy: { createdAt: 'asc' },
      })
      return ok(connections)
    } catch (error) {
      return err(dbError('Failed to list coexistence connections', error))
    }
  },
}
