import type { WhatsAppConversationEventWithActor } from '@/src/repositories/whatsapp-conversation-event.repository'
import type { WhatsAppConversationEventDTO } from '@/types/whatsapp-conversation'

export function toWhatsAppConversationEventDTO(
  event: WhatsAppConversationEventWithActor,
): WhatsAppConversationEventDTO {
  return {
    id: event.id,
    conversationId: event.conversationId,
    kind: event.kind,
    source: event.source,
    actorUserId: event.actorUserId,
    actorName: event.actorUser?.name ?? null,
    reason: event.reason,
    closeOutcome: event.closeOutcome,
    closeStatusLabels: event.closeStatusLabels,
    createdAt: event.createdAt.toISOString(),
  }
}
