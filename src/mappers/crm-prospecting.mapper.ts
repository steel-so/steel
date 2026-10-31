import type {
  CrmProspectDraft,
  CrmProspectingSettings,
  CrmProspectUsage,
} from '@prisma/client'
import {
  PROSPECT_SIGNAL_LABELS,
  PROSPECT_SIGNAL_TYPES,
  type ProspectSignalType,
} from '@/src/lib/prospecting/signals'
import type {
  CrmProspectDraftDTO,
  CrmProspectingSettingsDTO,
  CrmProspectingUsageDTO,
  CrmProspectSignalDTO,
  CrmProspectSourceDTO,
} from '@/types/crm-prospecting'

export const DEFAULT_WEB_LIMIT = 300
export const DEFAULT_DRAFT_LIMIT = 100

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isSignalType = (value: unknown): value is ProspectSignalType =>
  typeof value === 'string' &&
  (PROSPECT_SIGNAL_TYPES as readonly string[]).includes(value)

/** The JSON columns are written by us, but a bad row must not break a screen. */
export function parseSignals(value: unknown): CrmProspectSignalDTO[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): CrmProspectSignalDTO[] => {
    if (!isRecord(item) || !isSignalType(item.type)) return []
    if (typeof item.evidence !== 'string') return []
    return [
      {
        type: item.type,
        label: PROSPECT_SIGNAL_LABELS[item.type],
        evidence: item.evidence,
        sourceUrl: typeof item.sourceUrl === 'string' ? item.sourceUrl : null,
      },
    ]
  })
}

export function parseSources(value: unknown): CrmProspectSourceDTO[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): CrmProspectSourceDTO[] => {
    if (!isRecord(item) || typeof item.url !== 'string') return []
    return [
      {
        url: item.url,
        title: typeof item.title === 'string' ? item.title : null,
      },
    ]
  })
}

export function toCrmProspectDraftDTO(row: CrmProspectDraft): CrmProspectDraftDTO {
  return {
    id: row.id,
    leadId: row.leadId,
    companyId: row.companyId,
    personId: row.personId,
    targetName: row.targetName,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    toEmail: row.toEmail,
    toPhone: row.toPhone,
    summary: row.summary,
    signals: parseSignals(row.signals),
    sources: parseSources(row.sources),
    status: row.status,
    agentId: row.agentId,
    createdById: row.createdById,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** No row means "never configured": everything off, default limits. */
export function toCrmProspectingSettingsDTO(
  row: CrmProspectingSettings | null,
  searchAvailable: boolean,
): CrmProspectingSettingsDTO {
  return {
    enabled: row?.enabled ?? false,
    monthlyWebLimit: row?.monthlyWebLimit ?? DEFAULT_WEB_LIMIT,
    monthlyDraftLimit: row?.monthlyDraftLimit ?? DEFAULT_DRAFT_LIMIT,
    allowedChannels: row?.allowedChannels ?? ['EMAIL', 'WHATSAPP'],
    valueProposition: row?.valueProposition ?? null,
    signalKeywords: row?.signalKeywords ?? [],
    searchAvailable,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  }
}

export function toCrmProspectingUsageDTO(
  row: CrmProspectUsage | null,
  period: Date,
  limits: { web: number; draft: number },
): CrmProspectingUsageDTO {
  return {
    period: period.toISOString(),
    searches: row?.searches ?? 0,
    fetches: row?.fetches ?? 0,
    drafts: row?.drafts ?? 0,
    webLimit: limits.web,
    draftLimit: limits.draft,
  }
}
