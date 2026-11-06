import type { WhatsAppAgentReportSettings } from '@prisma/client'
import type { WhatsAppAgentReportSettingsDTO } from '@/types/whatsapp-agent-report'

/** A workspace that never saved the settings has the report off. */
export function toWhatsAppAgentReportSettingsDTO(
  settings: WhatsAppAgentReportSettings | null,
): WhatsAppAgentReportSettingsDTO {
  return {
    enabled: settings?.enabled ?? false,
    updatedAt: settings?.updatedAt.toISOString() ?? null,
  }
}
