import type { WhatsAppAiCampaignActionRun } from '@prisma/client'
import type {
  WhatsAppAiCampaignRecipientRow,
  WhatsAppAiCampaignWithTemplate,
} from '@/src/repositories/whatsapp-ai-campaign.repository'
import {
  type AiCampaignAction,
  AiCampaignActionSchema,
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

/**
 * Stored JSON → typed actions, one by one: an invalid action is dropped (and
 * counted) instead of taking every other action of the campaign with it, and
 * a repeated id keeps its first occurrence.
 */
export function parseAiCampaignActionsDetailed(raw: unknown): {
  actions: AiCampaignAction[]
  invalid: number
} {
  if (!Array.isArray(raw)) return { actions: [], invalid: 0 }
  const actions: AiCampaignAction[] = []
  const ids = new Set<string>()
  let invalid = 0
  for (const item of raw) {
    const parsed = AiCampaignActionSchema.safeParse(item)
    if (!parsed.success || ids.has(parsed.data.id)) {
      invalid += 1
      continue
    }
    ids.add(parsed.data.id)
    actions.push(parsed.data)
  }
  return { actions, invalid }
}

/** Stored JSON → typed actions (invalid ones are left out). */
export function parseAiCampaignActions(raw: unknown): AiCampaignAction[] {
  return parseAiCampaignActionsDetailed(raw).actions
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
    skipNoWhatsapp: campaign.skipNoWhatsapp,
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
    contactCreatedAt: row.contact.createdAt.toISOString(),
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
