import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppQuickReply } from '@prisma/client'

export function createFakeWhatsAppQuickReply(
  overrides?: Partial<WhatsAppQuickReply>,
): WhatsAppQuickReply {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    shortcut: 'saudacao',
    title: 'Saudação',
    body: 'Olá! Como posso ajudar?',
    mediaUrl: null,
    buttons: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
