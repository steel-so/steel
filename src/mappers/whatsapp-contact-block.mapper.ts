import { isWhatsAppPhone } from '@/src/lib/whatsapp/phone'
import type { WhatsAppContactBlockWithRefs } from '@/src/repositories/whatsapp-contact-block.repository'
import type { WhatsAppContactBlockDTO } from '@/types/whatsapp-contact-block'

/** `blockedById -> name` of the members who blocked, resolved in batch. */
export type BlockerNames = Map<string, string>

export function toWhatsAppContactBlockDTO(
  row: WhatsAppContactBlockWithRefs,
  blockers: BlockerNames = new Map(),
): WhatsAppContactBlockDTO {
  const blockerName = row.blockedById ? blockers.get(row.blockedById) : null
  return {
    id: row.id,
    connectionId: row.connectionId,
    connectionLabel: row.connection.label,
    connectionPhoneNumber: row.connection.phoneNumber,
    provider: row.connection.provider,
    contactId: row.contactId,
    contactName: row.contact?.name ?? null,
    waId: row.waId,
    hasPhone: isWhatsAppPhone(row.waId),
    reason: row.reason,
    providerStatus: row.providerStatus,
    providerError: row.providerError,
    appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
    origin: row.origin,
    droppedCount: row.droppedCount,
    lastDroppedAt: row.lastDroppedAt ? row.lastDroppedAt.toISOString() : null,
    blockedBy:
      row.blockedById && blockerName
        ? { id: row.blockedById, name: blockerName }
        : null,
    blockedAt: row.blockedAt.toISOString(),
  }
}
