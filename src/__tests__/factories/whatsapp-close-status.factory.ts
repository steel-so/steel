import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppCloseStatus } from '@prisma/client'

export function createFakeWhatsAppCloseStatus(
  overrides?: Partial<WhatsAppCloseStatus>,
): WhatsAppCloseStatus {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    label: 'Venda realizada',
    outcome: 'SUCCESS',
    position: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
