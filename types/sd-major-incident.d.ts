import type { SdUserSummaryDTO } from './sd-ticket'

export type SdMajorIncidentStatusDTO =
  | 'INVESTIGATING'
  | 'IDENTIFIED'
  | 'MONITORING'
  | 'RESOLVED'
export type SdMajorIncidentImpactDTO =
  | 'DEGRADED'
  | 'PARTIAL_OUTAGE'
  | 'MAJOR_OUTAGE'
export type SdIncidentLinkSourceDTO =
  | 'MANUAL'
  | 'SUGGESTION'
  | 'MONITORING'
  | 'AUTOMATION'
export type SdStatusChannelDTO = 'EMAIL' | 'WHATSAPP'
export type SdStatusPageOverallDTO = 'OPERATIONAL' | SdMajorIncidentImpactDTO

export interface SdMajorIncidentSummaryDTO {
  id: string
  /** Master ticket. */
  ticketId: string
  ticketNumber: number
  ticketCode: string
  title: string
  impact: SdMajorIncidentImpactDTO
  status: SdMajorIncidentStatusDTO
  commander: SdUserSummaryDTO | null
  declaredAt: string
  resolvedAt: string | null
  childCount: number
  pageCount: number
}

export interface SdMajorIncidentUpdateDTO {
  id: string
  status: SdMajorIncidentStatusDTO
  message: string
  /** Shown on the status pages. */
  publish: boolean
  author: SdUserSummaryDTO | null
  createdAt: string
  /** Delivery of the e-mail/WhatsApp notices (published updates only). */
  notify: {
    done: boolean
    total: number
    sent: number
    failed: number
  }
}

export interface SdMajorIncidentChildDTO {
  ticketId: string
  number: number
  code: string
  title: string
  phase: string
  /** Phase category (OPEN, RESOLVED, CLOSED...). */
  phaseCategory: string
  source: SdIncidentLinkSourceDTO
  linkedAt: string
  linkedBy: SdUserSummaryDTO | null
}

export interface SdMajorIncidentPageRefDTO {
  id: string
  name: string
  slug: string
}

export interface SdMajorIncidentDTO extends SdMajorIncidentSummaryDTO {
  ticketTitle: string
  summary: string | null
  resolution: string | null
  declaredBy: SdUserSummaryDTO | null
  resolvedBy: SdUserSummaryDTO | null
  /** War room (swarm on the master ticket), when one was opened. */
  swarmId: string | null
  updates: SdMajorIncidentUpdateDTO[]
  children: SdMajorIncidentChildDTO[]
  pages: SdMajorIncidentPageRefDTO[]
}

/** Outcome of one child ticket when the incident resolves in bulk. */
export interface SdMajorIncidentChildResolutionDTO {
  ticketId: string
  code: string
  title: string
  /** RESOLVED: moved to the resolved phase; SKIPPED: nothing to do; FAILED: the engine refused. */
  outcome: 'RESOLVED' | 'SKIPPED' | 'FAILED'
  /** Why it was skipped or failed (pt-BR). */
  reason: string | null
}

/** The resolved incident plus what happened to the children asked for. */
export interface SdMajorIncidentResolveDTO extends SdMajorIncidentDTO {
  childResults: SdMajorIncidentChildResolutionDTO[]
}

export interface SdMajorIncidentListDTO {
  items: SdMajorIncidentSummaryDTO[]
}

/** What the ticket screen needs: its own incident and the one it belongs to. */
export interface SdTicketMajorIncidentDTO {
  /** The ticket is the master of this incident (active one first). */
  master: SdMajorIncidentSummaryDTO | null
  /** The ticket is a child of this incident. */
  child: SdMajorIncidentSummaryDTO | null
  /** The ticket is an INCIDENT that may be declared major. */
  canDeclare: boolean
  /** Pages the declare dialog preselects (customer/service match). */
  suggestedPageIds: string[]
}

export interface SdMajorIncidentSuggestionDTO {
  ticketId: string
  number: number
  code: string
  title: string
  createdAt: string
  /** Why it looks related. */
  reasons: ('CATEGORY' | 'CONFIG_ITEM' | 'CUSTOMER')[]
}

export interface SdMajorIncidentSuggestionListDTO {
  items: SdMajorIncidentSuggestionDTO[]
}

export interface SdMajorIncidentLinkResultDTO {
  linked: number
  /** Already linked, closed to linking or not found. */
  skipped: { ref: string; reason: string }[]
}

export interface SdMajorIncidentDeclareDTO {
  incident: SdMajorIncidentDTO
  /** Things that did not go as asked (war room, child tickets). pt-BR. */
  warnings: string[]
}
