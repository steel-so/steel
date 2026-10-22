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
    callRecordingEnabled: false,
    callRecordingNotice: null,
    callRecordingRetentionDays: 90,
    callTranscriptionEnabled: true,
    closeStatusMinSelections: 0,
    closeStatusMaxSelections: 1,
    businessHoursEnabled: false,
    businessHoursStart: '08:00',
    businessHoursEnd: '18:00',
    businessHoursDays: [1, 2, 3, 4, 5],
    whatsappCheckTtlDays: 30,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
