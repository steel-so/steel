import type { WhatsAppSettings } from '@prisma/client'
import type { WhatsAppSettingsDTO } from '@/types/whatsapp-settings'

/** Aviso de gravação quando o workspace não escreveu o próprio. */
export const DEFAULT_CALL_RECORDING_NOTICE =
  'Avise o contato: "Esta ligação está sendo gravada para registro e qualidade do atendimento."'

/** Padrões quando o workspace ainda não salvou configurações. */
export const WHATSAPP_SETTINGS_DEFAULTS = {
  autoCloseAfterHours: 24,
  sentimentAlertEnabled: true,
  sentimentAlertThreshold: -0.3,
  sentimentAlertNotifyInApp: true,
  sentimentAlertNotifyEmail: false,
  sentimentAlertRecipientIds: [] as string[],
  sentimentAlertAssignToId: null as string | null,
  sentimentAlertCooldownHours: 6,
  callRecordingEnabled: false,
  callRecordingNotice: null as string | null,
  callRecordingRetentionDays: 90,
  callTranscriptionEnabled: true,
  closeStatusMinSelections: 0,
  closeStatusMaxSelections: 1,
  businessHoursEnabled: false,
  businessHoursStart: '08:00',
  businessHoursEnd: '18:00',
  businessHoursDays: [1, 2, 3, 4, 5] as number[],
}

export function toWhatsAppSettingsDTO(
  workspaceId: string,
  settings: WhatsAppSettings | null,
): WhatsAppSettingsDTO {
  if (!settings) {
    return {
      workspaceId,
      ...WHATSAPP_SETTINGS_DEFAULTS,
      sentimentAlertRecipientIds: [],
      businessHoursDays: [...WHATSAPP_SETTINGS_DEFAULTS.businessHoursDays],
      callRecordingNotice: DEFAULT_CALL_RECORDING_NOTICE,
    }
  }
  return {
    workspaceId,
    autoCloseAfterHours: settings.autoCloseAfterHours,
    sentimentAlertEnabled: settings.sentimentAlertEnabled,
    sentimentAlertThreshold: settings.sentimentAlertThreshold,
    sentimentAlertNotifyInApp: settings.sentimentAlertNotifyInApp,
    sentimentAlertNotifyEmail: settings.sentimentAlertNotifyEmail,
    sentimentAlertRecipientIds: settings.sentimentAlertRecipientIds,
    sentimentAlertAssignToId: settings.sentimentAlertAssignToId,
    sentimentAlertCooldownHours: settings.sentimentAlertCooldownHours,
    callRecordingEnabled: settings.callRecordingEnabled,
    callRecordingNotice:
      settings.callRecordingNotice?.trim() || DEFAULT_CALL_RECORDING_NOTICE,
    callRecordingRetentionDays: settings.callRecordingRetentionDays,
    callTranscriptionEnabled: settings.callTranscriptionEnabled,
    closeStatusMinSelections: settings.closeStatusMinSelections,
    closeStatusMaxSelections: settings.closeStatusMaxSelections,
    businessHoursEnabled: settings.businessHoursEnabled,
    businessHoursStart: settings.businessHoursStart,
    businessHoursEnd: settings.businessHoursEnd,
    businessHoursDays: settings.businessHoursDays,
  }
}
