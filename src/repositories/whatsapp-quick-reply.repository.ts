import { Prisma, type WhatsAppQuickReply } from '@prisma/client'
import { whatsappQuickReplyConflict } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const WhatsAppQuickReplyRepository = {
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<WhatsAppQuickReply[]>> {
    try {
      const quickReplies = await prisma.whatsAppQuickReply.findMany({
        where: { workspaceId },
        orderBy: { shortcut: 'asc' },
      })
      return ok(quickReplies)
    } catch (error) {
      return err(dbError('Failed to list whatsapp quick replies', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppQuickReply | null>> {
    try {
      const quickReply = await prisma.whatsAppQuickReply.findFirst({
        where: { id, workspaceId },
      })
      return ok(quickReply)
    } catch (error) {
      return err(dbError('Failed to find whatsapp quick reply', error))
    }
  },

  async create(data: {
    workspaceId: string
    shortcut: string
    title: string
    body: string
    mediaUrl?: string
    buttons?: Prisma.InputJsonValue
  }): Promise<Result<WhatsAppQuickReply>> {
    try {
      const quickReply = await prisma.whatsAppQuickReply.create({ data })
      return ok(quickReply)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        return err(whatsappQuickReplyConflict())
      }
      return err(dbError('Failed to create whatsapp quick reply', error))
    }
  },

  async update(
    id: string,
    data: {
      shortcut?: string
      title?: string
      body?: string
      mediaUrl?: string
      /** `null` removes the buttons. */
      buttons?: Prisma.InputJsonValue | null
    },
  ): Promise<Result<WhatsAppQuickReply>> {
    try {
      const { buttons, ...rest } = data
      const quickReply = await prisma.whatsAppQuickReply.update({
        where: { id },
        data: {
          ...rest,
          ...(buttons === undefined
            ? {}
            : { buttons: buttons === null ? Prisma.DbNull : buttons }),
        },
      })
      return ok(quickReply)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        return err(whatsappQuickReplyConflict())
      }
      return err(dbError('Failed to update whatsapp quick reply', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.whatsAppQuickReply.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete whatsapp quick reply', error))
    }
  },
}
