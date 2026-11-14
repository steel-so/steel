import { prisma } from '@/src/lib/prisma'
import type { Result } from '@/src/lib/result'
import { sdDb } from './sd-config-db'

export interface SdRequesterContactState {
  /** LGPD opt-out of the WhatsApp contact (`broadcastOptedOutAt`). */
  optedOut: boolean
  /** Last message the contact sent on this connection. */
  lastInboundAt: Date | null
}

export const SdRequesterWhatsappRepository = {
  /** Opt-out and last inbound message of a phone on one connection. */
  async contactState(
    workspaceId: string,
    connectionId: string,
    waId: string,
  ): Promise<Result<SdRequesterContactState>> {
    return sdDb('Failed to read requester WhatsApp contact state', async () => {
      const [contact, inbound] = await Promise.all([
        prisma.whatsAppContact.findUnique({
          where: { workspaceId_waId: { workspaceId, waId } },
          select: { broadcastOptedOutAt: true },
        }),
        prisma.whatsAppMessage.findFirst({
          where: {
            direction: 'IN',
            deletedAt: null,
            conversation: {
              workspaceId,
              connectionId,
              contact: { waId },
            },
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ])
      return {
        optedOut: contact?.broadcastOptedOutAt != null,
        lastInboundAt: inbound?.createdAt ?? null,
      }
    })
  },

  /** Is the template APPROVED on the connection? */
  async isTemplateApproved(
    workspaceId: string,
    connectionId: string,
    name: string,
    language: string,
  ): Promise<Result<boolean>> {
    return sdDb('Failed to check requester WhatsApp template', async () => {
      const count = await prisma.whatsAppTemplate.count({
        where: {
          workspaceId,
          connectionId,
          name,
          language,
          status: 'APPROVED',
        },
      })
      return count > 0
    })
  },
}
