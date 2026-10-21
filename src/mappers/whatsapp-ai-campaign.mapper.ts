import type { WhatsAppAiCampaignActionRun } from '@prisma/client'
import type {
  WhatsAppAiCampaignRecipientRow,
  WhatsAppAiCampaignWithTemplate,
} from '@/src/repositories/whatsapp-ai-campaign.repository'
import {
  type AiCampaignAction,
  AiCampaignActionsSchema,
  type AiCampaignVariables,
  AiCampaignVariablesSchema,
} from '@/src/schemas/whatsapp-ai-campaign.schema'
import type {
  WhatsAppAiCampaignActionRunDTO,
  WhatsAppAiCampaignDTO,
  WhatsAppAiCampaignRecipientDTO,
  WhatsAppAiCampaignStatsDTO,
} from '@/types/whatsapp-ai-campaign'

/** Stored JSON → typed variables (a corrupt value reads as "nothing mapped"). */
export function parseAiCampaignVariables(raw: unknown): AiCampaignVariables {
  const parsed = AiCampaignVariablesSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : { header: {}, body: {}, buttons: {} }
}

/** Stored JSON → typed actions (a corrupt value reads as "no actions"). */
export function parseAiCampaignActions(raw: unknown): AiCampaignAction[] {
  const parsed = AiCampaignActionsSchema.safeParse(raw ?? [])
  return parsed.success ? parsed.data : []
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

export function toWhatsAppAiCampaignDTO(
  campaign: WhatsAppAiCampaignWithTemplate,
  stats: WhatsAppAiCampaignStatsDTO,
  problems: string[],
): WhatsAppAiCampaignDTO {
  return {
    id: campaign.id,
    name: campaign.name,
    objective: campaign.objective,
    connectionId: campaign.connectionId,
    templateId: campaign.templateId,
    template: campaign.template
      ? {
          id: campaign.template.id,
          name: campaign.template.name,
          language: campaign.template.language,
          status: campaign.template.status,
        }
      : null,
    variables: parseAiCampaignVariables(campaign.variables),
    headerMediaUrl: campaign.headerMediaUrl,
    instructions: campaign.instructions,
    actions: parseAiCampaignActions(campaign.actions),
    intervalSeconds: campaign.intervalSeconds,
    aiReplies: campaign.aiReplies,
    status: campaign.status,
    lastSentAt: iso(campaign.lastSentAt),
    lastError: campaign.lastError,
    startedAt: iso(campaign.startedAt),
    finishedAt: iso(campaign.finishedAt),
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
    stats,
    problems,
  }
}

function recipientValues(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

export function toWhatsAppAiCampaignRecipientDTO(
  row: WhatsAppAiCampaignRecipientRow,
): WhatsAppAiCampaignRecipientDTO {
  return {
    id: row.id,
    contactId: row.contactId,
    contactName: row.contact.name,
    waId: row.contact.waId,
    status: row.status,
    errorMessage: row.errorMessage,
    values: recipientValues(row.values),
    sentAt: iso(row.sentAt),
    repliedAt: iso(row.repliedAt),
    conversationId: row.conversationId,
    conversationStatus: row.conversation?.status ?? null,
    closeOutcome: row.conversation?.closeOutcome ?? null,
  }
}

export function recipientValuesOf(raw: unknown): Record<string, string> {
  return recipientValues(raw)
}

export function toWhatsAppAiCampaignActionRunDTO(
  run: WhatsAppAiCampaignActionRun & { contactName: string | null },
): WhatsAppAiCampaignActionRunDTO {
  return {
    id: run.id,
    conversationId: run.conversationId,
    contactName: run.contactName,
    actionId: run.actionId,
    kind: run.kind,
    label: run.label,
    reason: run.reason,
    status: run.status,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
  }
}
