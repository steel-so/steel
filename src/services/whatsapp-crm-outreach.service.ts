import { ok, type Result } from '@/src/lib/result'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'

/**
 * Every WhatsApp message the CRM originates (campaigns, cadences, workflows,
 * newsletters, documents, the lead's "chamar no WhatsApp") calls this before
 * sending. It marks the contact, and from then on the AI never answers it —
 * the inbound webhook and the AI reply job both check the mark. It never
 * renames an existing contact. Call it
 * BEFORE the send so a fast reply cannot beat the mark.
 */
export async function markCrmOutreach(
  workspaceId: string,
  waId: string,
): Promise<Result<void>> {
  const marked = await WhatsAppContactRepository.markCrmOutreach({
    workspaceId,
    waId,
  })
  return marked.ok ? ok(undefined) : marked
}
