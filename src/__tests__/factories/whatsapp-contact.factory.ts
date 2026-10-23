import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppContact } from '@prisma/client'
import type { WhatsAppContactWithCount } from '@/src/repositories/whatsapp-contact.repository'

export function createFakeWhatsAppContact(
  overrides?: Partial<WhatsAppContactWithCount>,
): WhatsAppContactWithCount {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    waId: '5511988887777',
    bsuid: null,
    username: null,
    name: 'Maria Silva',
    avatarUrl: null,
    description: null,
    broadcastOptedOutAt: null,
    broadcastOptOutSource: null,
    hasWhatsapp: null,
    whatsappCheckedAt: null,
    whatsappLid: null,
    createdAt: now,
    updatedAt: now,
    _count: { conversations: 0 },
    ...overrides,
  }
}

export function createFakeWhatsAppContactWithoutCount(
  overrides?: Partial<WhatsAppContact>,
): WhatsAppContact {
  const { _count, ...contact } = createFakeWhatsAppContact()
  return { ...contact, ...overrides }
}
