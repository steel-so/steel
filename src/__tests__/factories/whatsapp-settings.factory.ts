import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppSettings } from '@prisma/client'

export function createFakeWhatsAppSettings(
  overrides?: Partial<WhatsAppSettings>,
): WhatsAppSettings {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    autoCloseAfterHours: 24,
    sentimentAlertEnabled: true,
    sentimentAlertThreshold: -0.3,
    sentimentAlertNotifyInApp: true,
    sentimentAlertNotifyEmail: false,
    sentimentAlertRecipientIds: [],
    sentimentAlertAssignToId: null,
    sentimentAlertCooldownHours: 6,
    monthlyConversationLimit: null,
    monthlyMessageLimit: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
