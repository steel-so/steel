import type { WhatsAppPhoneCall } from '@prisma/client'
import type { WhatsAppPhoneCallDTO } from '@/types/whatsapp-phone-call'

export function toWhatsAppPhoneCallDTO(
  call: WhatsAppPhoneCall,
): WhatsAppPhoneCallDTO {
  return {
    id: call.id,
    conversationId: call.conversationId,
    userId: call.userId,
    extension: call.extension,
    destination: call.destination,
    status: call.status,
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    durationSeconds: call.durationSeconds,
    createdAt: call.createdAt.toISOString(),
  }
}
