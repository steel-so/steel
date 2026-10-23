import type { WhatsAppContact } from '@prisma/client'
import { isWhatsAppPhone } from '@/src/lib/whatsapp/phone'
import type { WhatsAppContactDTO } from '@/types/whatsapp-contact'

export function toWhatsAppContactDTO(
  contact: WhatsAppContact & { _count?: { conversations: number } },
): WhatsAppContactDTO {
  return {
    id: contact.id,
    workspaceId: contact.workspaceId,
    waId: contact.waId,
    username: contact.username,
    hasPhone: isWhatsAppPhone(contact.waId),
    name: contact.name,
    avatarUrl: contact.avatarUrl,
    description: contact.description,
    broadcastOptedOutAt: contact.broadcastOptedOutAt
      ? contact.broadcastOptedOutAt.toISOString()
      : null,
    broadcastOptOutSource: contact.broadcastOptOutSource,
    hasWhatsapp: contact.hasWhatsapp,
    whatsappCheckedAt: contact.whatsappCheckedAt
      ? contact.whatsappCheckedAt.toISOString()
      : null,
    conversationCount: contact._count?.conversations ?? 0,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  }
}
