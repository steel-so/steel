import type { WhatsAppConversation } from '@prisma/client'
import {
  type ConversationWaitingReason,
  communicationConversationWaitingData,
} from '@/src/lib/webhooks/payloads'
import { emitWebhookEvent } from './webhook-emitter'

/**
 * `communication.conversation.waiting` (ADR 0036): a Comunicação
 * conversation just entered the agents' queue — open, not archived, with no
 * assignee (`WhatsAppConversationService.listWaiting`). Called where that
 * happens: a contact opens or reopens an unassigned conversation, an agent
 * hands one back or reopens it without an assignee, a button moves it into a
 * team queue. Fire-and-forget, like every webhook emission.
 */
export function emitWhatsAppConversationWaiting(input: {
  conversation: WhatsAppConversation
  contact: { id: string; waId: string; name: string | null }
  reason: ConversationWaitingReason
  actorId: string | null
}): void {
  void emitWebhookEvent(
    input.conversation.workspaceId,
    'communication.conversation.waiting',
    () => communicationConversationWaitingData(input),
  )
}
