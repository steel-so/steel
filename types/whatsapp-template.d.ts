import type { WhatsAppButtonDTO } from './whatsapp-button'

export type WhatsAppTemplateStatusDTO =
  | 'APPROVED'
  | 'PENDING'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'

/** Meta quality rating — drives the green/yellow/red badge. */
export type WhatsAppTemplateQualityDTO = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'

export type WhatsAppTemplateHeaderFormatDTO =
  | 'TEXT'
  | 'IMAGE'
  | 'VIDEO'
  | 'DOCUMENT'

export interface WhatsAppTemplateDTO {
  id: string
  workspaceId: string
  connectionId: string
  name: string
  language: string
  category: string
  status: WhatsAppTemplateStatusDTO
  components: unknown[]
  /** Rating shown by the badge: the worse of the template's and the number's. */
  quality: WhatsAppTemplateQualityDTO
  /** Where `quality` comes from: the template's own score or the number's. */
  qualitySource: 'TEMPLATE' | 'NUMBER'
  /** Meta's own score of the template (`quality_score`). */
  templateQuality: WhatsAppTemplateQualityDTO
  /** Meta's rating of the number that sends it; UNKNOWN when not read. */
  numberQuality: WhatsAppTemplateQualityDTO
  qualityUpdatedAt: string | null
  statusReason: string | null
  headerFormat: WhatsAppTemplateHeaderFormatDTO | null
  headerMediaUrl: string | null
  /** Always present: stored buttons, or derived from `components` (no
   * actions) for templates synced from Meta. */
  buttons: WhatsAppButtonDTO[]
  createdAt: string
  updatedAt: string
}
