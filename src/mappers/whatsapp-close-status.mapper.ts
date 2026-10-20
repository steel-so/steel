import type { WhatsAppCloseStatus } from '@prisma/client'
import type { WhatsAppCloseStatusDTO } from '@/types/whatsapp-close-status'

export function toWhatsAppCloseStatusDTO(
  status: WhatsAppCloseStatus,
): WhatsAppCloseStatusDTO {
  return {
    id: status.id,
    label: status.label,
    outcome: status.outcome,
    position: status.position,
  }
}
