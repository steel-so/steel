/** Where the contact on screen was read from. */
export type ContactSource = 'whatsapp' | 'gmail' | 'linkedin'

/** The person the side panel is about, read from the page by a content script. */
export interface Contact {
  source: ContactSource
  name: string | null
  /** Digits only, with country code (`5511912345678`). */
  phones: string[]
  /** Lower case. */
  emails: string[]
  company: string | null
  jobTitle: string | null
  /** `https://www.linkedin.com/in/<slug>` */
  linkedin: string | null
}

export interface LeadSummary {
  id: string
  name: string
  emails: string[]
  phones: string[]
  company: string | null
  jobTitle: string | null
  linkedin: string | null
  stage: string
}

export type MatchReason = 'phone' | 'email' | 'linkedin' | 'name'

export interface LeadMatch {
  lead: LeadSummary
  reason: MatchReason
}

export interface TicketSummary {
  id: string
  number: number | null
  code: string
  title: string
  type: string
  phase: string
  createdAt: string | null
}

export type TicketType = 'INCIDENT' | 'SERVICE_REQUEST' | 'CHANGE' | 'PROBLEM'

/** What `GET /api/v1/me` says about the token. */
export interface MeSummary {
  userName: string
  workspaceName: string
  workspaceSlug: string
  scopes: string[]
  modules: string[]
  expiresAt: string | null
}

export interface Config {
  /** Origin of the Steel, without a trailing slash. */
  baseUrl: string
  token: string
  me: MeSummary
}

export interface LeadForm {
  name: string
  email: string
  phone: string
  company: string
  jobTitle: string
}

export interface TicketForm {
  type: TicketType
  title: string
  note: string
}

export type Res<T> = { ok: true; data: T } | { ok: false; error: string }

export interface LookupState {
  configured: boolean
  /** Name of the workspace behind the token, for the header. */
  workspace: string | null
  canWrite: boolean
  hasCrm: boolean
  hasServiceDesk: boolean
  contact: Contact | null
  matches: LeadMatch[]
  tickets: TicketSummary[]
  /** Base URL of the Steel, to build the "open in Steel" links. */
  baseUrl: string | null
  workspaceSlug: string | null
  leadsError: string | null
  ticketsError: string | null
}

/** Messages sent to the service worker. */
export type Message =
  | { type: 'contact'; contact: Contact | null }
  | { type: 'state'; tabId: number | null }
  | { type: 'save-config'; baseUrl: string; token: string }
  | { type: 'clear-config' }
  | { type: 'create-lead'; tabId: number | null; form: LeadForm }
  | { type: 'create-ticket'; tabId: number | null; form: TicketForm }
  | { type: 'refresh'; tabId: number | null }

/** A tiny async key-value store; chrome.storage areas implement it. */
export interface Store {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

/** The slice of the SDK client this extension uses. */
export interface ApiClient {
  request(options: {
    method: string
    path: string
    query?: Record<string, string | string[]>
    body?: unknown
  }): Promise<
    | { ok: true; data: { ok: boolean; status: number; body: unknown } }
    | {
        ok: false
        error: { code: string; message?: string; status: number }
      }
  >
}
