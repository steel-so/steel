export type CrmProspectChannelDTO = 'EMAIL' | 'WHATSAPP'

export type CrmProspectDraftStatusDTO =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'SENT'

export type CrmProspectSignalTypeDTO =
  | 'HIRING'
  | 'FUNDING'
  | 'EXPANSION'
  | 'TECH_CHANGE'
  | 'LEADERSHIP_CHANGE'
  | 'TENDER'
  | 'LAUNCH'
  | 'PAIN'
  | 'CUSTOM'

/** A buying signal with the evidence the agent quoted. */
export interface CrmProspectSignalDTO {
  type: CrmProspectSignalTypeDTO
  label: string
  evidence: string
  sourceUrl: string | null
}

export interface CrmProspectSourceDTO {
  url: string
  title: string | null
}

export interface CrmProspectingSettingsDTO {
  enabled: boolean
  monthlyWebLimit: number
  monthlyDraftLimit: number
  allowedChannels: CrmProspectChannelDTO[]
  valueProposition: string | null
  signalKeywords: string[]
  /** The environment has a web search key (the search tool works). */
  searchAvailable: boolean
  updatedAt: string | null
}

export interface CrmProspectingUsageDTO {
  /** ISO date of the first day of the month (UTC). */
  period: string
  searches: number
  fetches: number
  drafts: number
  webLimit: number
  draftLimit: number
}

export interface CrmProspectDraftDTO {
  id: string
  leadId: string | null
  companyId: string | null
  personId: string | null
  targetName: string
  channel: CrmProspectChannelDTO
  subject: string | null
  body: string
  toEmail: string | null
  toPhone: string | null
  summary: string | null
  signals: CrmProspectSignalDTO[]
  sources: CrmProspectSourceDTO[]
  status: CrmProspectDraftStatusDTO
  agentId: string | null
  createdById: string
  decidedById: string | null
  decidedAt: string | null
  rejectReason: string | null
  createdAt: string
  updatedAt: string
}
