import type { CrmHealthLevelDTO } from './crm-health'

/** How the 360 view found the customer (shown as a hint, never trusted blindly). */
export type Customer360MatchDTO =
  | 'person'
  | 'company'
  | 'phone'
  | 'email'
  | 'cnpj'
  | 'name'
  | 'none'

export interface Customer360PersonDTO {
  id: string
  name: string
  jobTitle: string | null
  emails: string[]
  phones: string[]
  companyId: string | null
}

export interface Customer360CompanyDTO {
  id: string
  name: string
  cnpj: string | null
  /** Annual recurring revenue; `null` when the company has none recorded. */
  arr: number | null
  accountOwnerId: string | null
  accountOwnerName: string | null
}

export interface Customer360HealthDTO {
  level: CrmHealthLevelDTO
  levelLabel: string
  riskScore: number
  healthScore: number
  nextActionLabel: string
  computedAt: string
}

export interface Customer360OpportunityDTO {
  id: string
  name: string
  amount: number | null
  stageName: string
  /** `OPEN`, `WON` or `LOST`. */
  stageCategory: string
  pipelineName: string
  ownerName: string | null
  closeDate: string | null
  updatedAt: string
}

export interface Customer360LeadDTO {
  id: string
  name: string
  stage: string
  ownerName: string | null
  createdAt: string
}

export interface Customer360TicketDTO {
  id: string
  number: number
  title: string
  type: string
  phaseName: string
  phaseCategory: string
  priorityName: string | null
  open: boolean
  slaBreached: boolean
  resolutionDueAt: string | null
  csatScore: number | null
  createdAt: string
}

export interface Customer360ConversationDTO {
  id: string
  contactName: string | null
  contactPhone: string
  status: string
  connectionLabel: string
  lastMessageAt: string | null
}

export interface Customer360CallDTO {
  id: string
  direction: string
  status: string
  durationSeconds: number | null
  summary: string | null
  conversationId: string | null
  createdAt: string
}

export interface Customer360DocumentDTO {
  id: string
  title: string
  kind: string
  status: string
  totalValue: number | null
  updatedAt: string
}

/** Which blocks the viewer may see (module enabled and permission granted). */
export interface Customer360AvailabilityDTO {
  crm: boolean
  servicedesk: boolean
  whatsapp: boolean
}

export interface Customer360DTO {
  match: Customer360MatchDTO
  available: Customer360AvailabilityDTO
  person: Customer360PersonDTO | null
  company: Customer360CompanyDTO | null
  health: Customer360HealthDTO | null
  opportunities: Customer360OpportunityDTO[]
  /** Leads still open (not converted) that share the phone or e-mail. */
  leads: Customer360LeadDTO[]
  tickets: Customer360TicketDTO[]
  openTickets: number
  conversations: Customer360ConversationDTO[]
  calls: Customer360CallDTO[]
  documents: Customer360DocumentDTO[]
}

export interface Customer360OpenWhatsappResultDTO {
  conversationId: string
  contactId: string
  phone: string
}
