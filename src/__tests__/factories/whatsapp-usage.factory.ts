import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppUsageMonthly } from '@prisma/client'

export function createFakeWhatsAppUsage(
  overrides?: Partial<WhatsAppUsageMonthly>,
): WhatsAppUsageMonthly {
  return {
    id: createId(),
    workspaceId: createId(),
    period: '2026-10',
    conversations: 0,
    outboundMessages: 0,
    updatedAt: new Date(),
    ...overrides,
  }
}
