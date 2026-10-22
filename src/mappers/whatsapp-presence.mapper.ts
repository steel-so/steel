import type { WhatsAppAgentPresence } from '@prisma/client'
import type { WhatsAppPresenceDTO } from '@/types/whatsapp-presence'

/** No row yet = the person never touched the toggle = available. */
export function toWhatsAppPresenceDTO(
  userId: string,
  row: WhatsAppAgentPresence | null | undefined,
): WhatsAppPresenceDTO {
  return {
    userId,
    status: row?.status ?? 'AVAILABLE',
    updatedAt: row ? row.updatedAt.toISOString() : null,
  }
}
