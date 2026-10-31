import type {
  Prisma,
  WhatsAppChannel,
  WhatsAppConnection,
  WhatsAppMetaChannelSettings,
  WhatsAppSocialComment,
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

  /**
   * Meta channel connections of a workspace (zap module): Instagram,
   * Messenger and the WhatsApp numbers connected through Coexistence.
   */
  async listSocialConnections(
    workspaceId: string,
  ): Promise<Result<WhatsAppConnection[]>> {
    try {
      const connections = await prisma.whatsAppConnection.findMany({
        where: {
          workspaceId,
          module: 'COMMUNICATION',
          OR: [
            { channel: { in: ['INSTAGRAM', 'MESSENGER'] } },
            { coexistence: true },
          ],
        },
        orderBy: { createdAt: 'asc' },
      })
      return ok(connections)
    } catch (error) {
      return err(dbError('Failed to list social connections', error))
    }
  },

  /**
   * Webhook lookup: the connection behind a Page id (Messenger) or an
   * Instagram account id (Instagram). Unscoped — the workspace comes from it.
   */
  async findByAccountId(
    channel: Exclude<WhatsAppChannel, 'WHATSAPP'>,
    accountId: string,
  ): Promise<Result<WhatsAppConnection | null>> {
    try {
      const connection = await prisma.whatsAppConnection.findFirst({
        where:
          channel === 'MESSENGER'
            ? { channel, metaPageId: accountId }
            : { channel, metaInstagramAccountId: accountId },
      })
      return ok(connection)
    } catch (error) {
      return err(dbError('Failed to find social connection', error))
    }
  },

  async findByPage(
    workspaceId: string,
    channel: Exclude<WhatsAppChannel, 'WHATSAPP'>,
    pageId: string,
  ): Promise<Result<WhatsAppConnection | null>> {
    try {
      const connection = await prisma.whatsAppConnection.findFirst({
        where: { workspaceId, channel, metaPageId: pageId },
      })
      return ok(connection)
    } catch (error) {
      return err(dbError('Failed to find social connection by page', error))
    }
  },

  async createComment(
    data: Prisma.WhatsAppSocialCommentUncheckedCreateInput,
  ): Promise<Result<WhatsAppSocialComment>> {
    try {
      const comment = await prisma.whatsAppSocialComment.upsert({
        where: { messageId: data.messageId },
        create: data,
        update: {},
      })
      return ok(comment)
    } catch (error) {
      return err(dbError('Failed to save social comment', error))
    }
  },

  async findCommentByMessageId(
    workspaceId: string,
    messageId: string,
  ): Promise<Result<WhatsAppSocialComment | null>> {
    try {
      const comment = await prisma.whatsAppSocialComment.findFirst({
        where: { workspaceId, messageId },
      })
      return ok(comment)
    } catch (error) {
      return err(dbError('Failed to find social comment', error))
    }
  },

  async listCommentsByConversation(
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<WhatsAppSocialComment[]>> {
    try {
      const messages = await prisma.whatsAppMessage.findMany({
        where: { conversationId, workspaceId },
        select: { id: true },
      })
      const comments = await prisma.whatsAppSocialComment.findMany({
        where: { workspaceId, messageId: { in: messages.map((m) => m.id) } },
        orderBy: { createdAt: 'asc' },
      })
      return ok(comments)
    } catch (error) {
      return err(dbError('Failed to list social comments', error))
    }
  },

  async markCommentReplied(id: string): Promise<Result<void>> {
    try {
      await prisma.whatsAppSocialComment.update({
        where: { id },
        data: { repliedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to mark social comment as replied', error))
    }
  },
}
