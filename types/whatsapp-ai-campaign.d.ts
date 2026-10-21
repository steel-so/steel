import type {
  AiCampaignAction,
  AiCampaignVariables,
} from '@/src/schemas/whatsapp-ai-campaign.schema'
import type { WhatsAppCloseOutcomeDTO } from './whatsapp-close-status'

export type WhatsAppAiCampaignStatusDTO =
  | 'DRAFT'
  | 'RUNNING'
  | 'PAUSED'
  | 'DONE'
  | 'ARCHIVED'

export type WhatsAppAiCampaignRecipientStatusDTO =
  | 'PENDING'
  | 'SENT'
  | 'FAILED'
  | 'SKIPPED'

/** Funil da campanha. */
export interface WhatsAppAiCampaignStatsDTO {
  /** Contatos na campanha. */
  total: number
  pending: number
  sent: number
  failed: number
  /** Descadastrados ou sem valor para alguma variável. */
  skipped: number
  /** Enviados que responderam. */
  replied: number
  /** Conversas da campanha fechadas como "deu certo" / "não deu". */
  success: number
  failure: number
  /** Fechadas sem classificação (ex.: inatividade = sem resposta). */
  closedWithoutOutcome: number
  /** Conversas da campanha ainda abertas. */
  open: number
}

export interface WhatsAppAiCampaignTemplateSummaryDTO {
  id: string
  name: string
  language: string
  status: string
}

export interface WhatsAppAiCampaignDTO {
  id: string
  name: string
  objective: string | null
  connectionId: string | null
  templateId: string | null
  template: WhatsAppAiCampaignTemplateSummaryDTO | null
  variables: AiCampaignVariables
  headerMediaUrl: string | null
  instructions: string
  actions: AiCampaignAction[]
  intervalSeconds: number
  aiReplies: boolean
  status: WhatsAppAiCampaignStatusDTO
  lastSentAt: string | null
  lastError: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
  stats: WhatsAppAiCampaignStatsDTO
  /** O que falta para iniciar (vazio = pronta). */
  problems: string[]
}

export interface WhatsAppAiCampaignRecipientDTO {
  id: string
  contactId: string
  contactName: string | null
  waId: string
  status: WhatsAppAiCampaignRecipientStatusDTO
  errorMessage: string | null
  values: Record<string, string>
  sentAt: string | null
  repliedAt: string | null
  conversationId: string | null
  conversationStatus: 'NEW' | 'IN_PROGRESS' | 'CLOSED' | null
  closeOutcome: WhatsAppCloseOutcomeDTO | null
}

export interface WhatsAppAiCampaignRecipientPageDTO {
  items: WhatsAppAiCampaignRecipientDTO[]
  nextCursor: string | null
}

export interface WhatsAppAiCampaignActionRunDTO {
  id: string
  conversationId: string | null
  contactName: string | null
  actionId: string
  kind: string
  label: string
  reason: string | null
  status: 'SUCCESS' | 'FAILED'
  error: string | null
  createdAt: string
}
