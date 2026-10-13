import type { Prisma, WhatsAppPhoneCall } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const WhatsAppPhoneCallRepository = {
  async create(
    data: Prisma.WhatsAppPhoneCallUncheckedCreateInput,
  ): Promise<Result<WhatsAppPhoneCall>> {
    try {
      return ok(await prisma.whatsAppPhoneCall.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create whatsapp phone call', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppPhoneCallUncheckedUpdateInput,
  ): Promise<Result<WhatsAppPhoneCall>> {
    try {
      return ok(await prisma.whatsAppPhoneCall.update({ where: { id }, data }))
    } catch (error) {
      return err(dbError('Failed to update whatsapp phone call', error))
    }
  },

  async findByCallbackTokenHash(
    callbackTokenHash: string,
  ): Promise<Result<WhatsAppPhoneCall | null>> {
    try {
      return ok(
        await prisma.whatsAppPhoneCall.findUnique({
          where: { callbackTokenHash },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp phone call', error))
    }
  },

  async findLatestByConversation(
    conversationId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppPhoneCall | null>> {
    try {
      return ok(
        await prisma.whatsAppPhoneCall.findFirst({
          where: { conversationId, workspaceId },
          orderBy: { createdAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(
        dbError('Failed to find the latest whatsapp phone call', error),
      )
    }
  },
}
