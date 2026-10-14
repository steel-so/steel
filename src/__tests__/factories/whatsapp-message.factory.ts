import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppMessage } from '@prisma/client'

export function createFakeWhatsAppMessage(
  overrides?: Partial<WhatsAppMessage>,
): WhatsAppMessage {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    conversationId: createId(),
    direction: 'IN',
    type: 'TEXT',
    text: 'Olá, tudo bem?',
    mediaUrl: null,
    providerMessageId: createId(),
    status: 'DELIVERED',
    senderUserId: null,
    sentByAi: false,
    replyToMessageId: null,
    reactionEmoji: null,
    reactedByContact: null,
    contactPayload: null,
    buttons: null,
    buttonPayload: null,
    sentiment: null,
    sentimentScore: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
