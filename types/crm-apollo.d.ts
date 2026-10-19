/**
 * DTOs of the Apollo.io lead import. The API key never appears here: the
 * connection only exposes whether it exists and its last 4 characters.
 */

export type CrmApolloImportStatusDTO =
  | 'QUEUED'
  | 'RUNNING'
  | 'DONE'
  | 'FAILED'
  | 'PAUSED_RATE_LIMIT'

export type CrmApolloImportSourceDTO = 'SEARCH' | 'LIST'

export interface CrmApolloRateLimitDTO {
  minuteLeft: number | null
  hourLeft: number | null
  dayLeft: number | null
}

export interface CrmApolloConnectionDTO {
  connected: boolean
  status: 'ACTIVE' | 'ERROR' | 'DISCONNECTED' | null
  statusError: string | null
  /** `••••abcd` — last 4 characters of the key. */
  keyHint: string | null
  lastCheckedAt: string | null
  defaultMailingListId: string | null
  /** false when the public URL is not HTTPS (Apollo refuses the callback). */
  phoneRevealAvailable: boolean
}

export interface CrmApolloPersonDTO {
  id: string
  /** Apollo hides the surname before enrichment (`Ro***s`). */
  name: string
  title: string | null
  organizationName: string | null
  hasEmail: boolean
}

export interface CrmApolloSearchResultDTO {
  totalEntries: number
  page: number
  perPage: number
  totalPages: number
  people: CrmApolloPersonDTO[]
  rateLimit: CrmApolloRateLimitDTO
}

export interface CrmApolloLabelDTO {
  id: string
  name: string
  count: number
}

export interface CrmApolloContactDTO {
  id: string
  personId: string | null
  name: string
  email: string | null
  emailStatus: string | null
  title: string | null
  organizationName: string | null
  linkedinUrl: string | null
  city: string | null
}

export interface CrmApolloContactsResultDTO {
  totalEntries: number
  page: number
  perPage: number
  totalPages: number
  contacts: CrmApolloContactDTO[]
  rateLimit: CrmApolloRateLimitDTO
}

export interface CrmApolloImportDTO {
  id: string
  status: CrmApolloImportStatusDTO
  source: CrmApolloImportSourceDTO
  /** Human summary of the filters or of the saved list. */
  filters: unknown
  mailingListId: string | null
  requestedCount: number
  createdCount: number
  skippedCount: number
  failedCount: number
  creditsConsumed: number
  revealPhones: boolean
  phonesRequested: number
  phonesReceived: number
  /** Skip counts by reason (`no_email`, `opted_out`, ...). */
  skipReasons: Record<string, number>
  error: string | null
  createdById: string
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}
