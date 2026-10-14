import type { WhatsAppQuickReply } from '@prisma/client'
import { parseStoredButtons } from '@/src/lib/whatsapp/buttons'
import type { WhatsAppQuickReplyDTO } from '@/types/whatsapp-quick-reply'

export function toWhatsAppQuickReplyDTO(
  quickReply: WhatsAppQuickReply,
): WhatsAppQuickReplyDTO {
  return {
    id: quickReply.id,
    workspaceId: quickReply.workspaceId,
    shortcut: quickReply.shortcut,
    title: quickReply.title,
    body: quickReply.body,
    mediaUrl: quickReply.mediaUrl,
    buttons: parseStoredButtons(quickReply.buttons),
    createdAt: quickReply.createdAt.toISOString(),
    updatedAt: quickReply.updatedAt.toISOString(),
  }
}
