import type { WhatsAppTemplate } from '@prisma/client'
import {
  deriveTemplateButtons,
  parseStoredButtons,
} from '@/src/lib/whatsapp/buttons'
import type {
  WhatsAppTemplateDTO,
  WhatsAppTemplateQualityDTO,
} from '@/types/whatsapp-template'

const QUALITY_RANK: Record<WhatsAppTemplateQualityDTO, number> = {
  UNKNOWN: 0,
  GREEN: 1,
  YELLOW: 2,
  RED: 3,
}

/**
 * `numberQuality` is Meta's rating of the number that sends the template.
 * The badge shows the worse of the two ratings: a template the number can
 * barely deliver is not healthy, whatever its own score says.
 */
export function toWhatsAppTemplateDTO(
  template: WhatsAppTemplate,
  numberQuality: WhatsAppTemplateQualityDTO = 'UNKNOWN',
): WhatsAppTemplateDTO {
  const fromNumber =
    QUALITY_RANK[numberQuality] > QUALITY_RANK[template.quality]
  return {
    id: template.id,
    workspaceId: template.workspaceId,
    connectionId: template.connectionId,
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    components: Array.isArray(template.components) ? template.components : [],
    quality: fromNumber ? numberQuality : template.quality,
    qualitySource: fromNumber ? 'NUMBER' : 'TEMPLATE',
    templateQuality: template.quality,
    numberQuality,
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
