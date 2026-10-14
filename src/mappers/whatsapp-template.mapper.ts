import type { WhatsAppTemplate } from '@prisma/client'
import {
  deriveTemplateButtons,
  parseStoredButtons,
} from '@/src/lib/whatsapp/buttons'
import type { WhatsAppTemplateDTO } from '@/types/whatsapp-template'

export function toWhatsAppTemplateDTO(
  template: WhatsAppTemplate,
): WhatsAppTemplateDTO {
  return {
    id: template.id,
    workspaceId: template.workspaceId,
    connectionId: template.connectionId,
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    components: Array.isArray(template.components) ? template.components : [],
    quality: template.quality,
    qualityUpdatedAt: template.qualityUpdatedAt
      ? template.qualityUpdatedAt.toISOString()
      : null,
    statusReason: template.statusReason,
    headerFormat: template.headerFormat,
    headerMediaUrl: template.headerMediaUrl,
    buttons:
      template.buttons == null
        ? deriveTemplateButtons(template.components)
        : parseStoredButtons(template.buttons),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  }
}
