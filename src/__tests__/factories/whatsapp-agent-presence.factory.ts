import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppAgentPresence } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

export function createFakeWhatsAppAgentPresence(
  overrides?: Partial<WhatsAppAgentPresence>,
): WhatsAppAgentPresence {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    userId: createId(),
    status: 'AVAILABLE',
    lastAssignedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedWhatsAppAgentPresence(
  data: Pick<WhatsAppAgentPresence, 'workspaceId' | 'userId'> &
    Partial<Pick<WhatsAppAgentPresence, 'status' | 'lastAssignedAt'>>,
) {
  return prisma.whatsAppAgentPresence.create({ data })
}
