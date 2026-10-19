/**
 * Pure Apollo.io vocabulary: the filter options the UI offers, their pt-BR
 * labels and the mapping from Steel's filters to the Apollo request body. No
 * I/O, so the schema, the client, the service and the page share one table.
 */

export const APOLLO_SOURCE = 'apollo'
/** Lead `source` shown in the CRM for every imported person. */
export const APOLLO_LEAD_SOURCE = 'Apollo'
/** People enriched per `bulk_match` call (Apollo's hard limit). */
export const APOLLO_BULK_MATCH_SIZE = 10
/** Apollo's `per_page` ceiling and page ceiling. */
export const APOLLO_MAX_PER_PAGE = 100
export const APOLLO_MAX_PAGES = 500
/** People a single import may carry (keeps one run bounded). */
export const APOLLO_MAX_IMPORT = 1000

export const APOLLO_SENIORITIES = [
  { value: 'owner', label: 'Proprietário' },
  { value: 'founder', label: 'Fundador' },
  { value: 'c_suite', label: 'C-Level' },
  { value: 'partner', label: 'Sócio' },
  { value: 'vp', label: 'VP' },
  { value: 'head', label: 'Head' },
  { value: 'director', label: 'Diretor' },
  { value: 'manager', label: 'Gerente' },
  { value: 'senior', label: 'Sênior' },
  { value: 'entry', label: 'Júnior' },
  { value: 'intern', label: 'Estagiário' },
] as const

export const APOLLO_EMPLOYEE_RANGES = [
  { value: '1,10', label: '1 a 10' },
  { value: '11,50', label: '11 a 50' },
  { value: '51,200', label: '51 a 200' },
  { value: '201,500', label: '201 a 500' },
  { value: '501,1000', label: '501 a 1.000' },
  { value: '1001,5000', label: '1.001 a 5.000' },
  { value: '5001,10000', label: '5.001 a 10.000' },
  { value: '10001,', label: 'Mais de 10.000' },
] as const

export const APOLLO_EMAIL_STATUSES = [
  { value: 'verified', label: 'Verificado' },
  { value: 'unverified', label: 'Não verificado' },
  { value: 'likely to engage', label: 'Provável de engajar' },
  { value: 'unavailable', label: 'Indisponível' },
] as const

export interface ApolloSearchFilters {
  personTitles: string[]
  includeSimilarTitles: boolean
  seniorities: string[]
  personLocations: string[]
  organizationLocations: string[]
  organizationDomains: string[]
  employeeRanges: string[]
  keywords: string
  emailStatuses: string[]
}

/** Only the keys the user filled go to Apollo (empty arrays narrow nothing). */
export function buildApolloSearchBody(
  filters: ApolloSearchFilters,
  page: number,
  perPage: number,
): Record<string, unknown> {
  const body: Record<string, unknown> = { page, per_page: perPage }
  const arrays: Array<[string, string[]]> = [
    ['person_titles', filters.personTitles],
    ['person_seniorities', filters.seniorities],
    ['person_locations', filters.personLocations],
    ['organization_locations', filters.organizationLocations],
    ['q_organization_domains_list', filters.organizationDomains],
    ['organization_num_employees_ranges', filters.employeeRanges],
    ['contact_email_status', filters.emailStatuses],
  ]
  for (const [key, value] of arrays) {
    if (value.length > 0) body[key] = value
  }
  if (filters.personTitles.length > 0) {
    body.include_similar_titles = filters.includeSimilarTitles
  }
  const keywords = filters.keywords.trim()
  if (keywords) body.q_keywords = keywords
  return body
}

/** Masks the stored key for the UI: only the last 4 characters survive. */
export function maskApolloKey(key: string): string {
  return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`
}

/** E-mail statuses we accept as importable (never `unverified`/`unavailable`). */
export function isImportableEmailStatus(status: string | null | undefined) {
  return status === 'verified' || status === 'likely to engage'
}

export interface ApolloRateLimit {
  minuteLeft: number | null
  hourLeft: number | null
  dayLeft: number | null
}

/**
 * Phones from the webhook, as `+<digits>` (E.164 shape), deduplicated. Numbers
 * Apollo itself marks invalid and anything outside 8-15 digits are dropped.
 */
export function sanitizeApolloPhones(
  numbers: Array<{
    sanitized_number?: string | null
    raw_number?: string | null
    status_cd?: string | null
  }>,
): string[] {
  const out = new Set<string>()
  for (const entry of numbers) {
    if (entry.status_cd === 'invalid_number') continue
    const digits = (entry.sanitized_number ?? entry.raw_number ?? '').replace(
      /\D/g,
      '',
    )
    if (digits.length >= 8 && digits.length <= 15) out.add(`+${digits}`)
  }
  return [...out]
}

/** A person without an importable e-mail whose phone was requested. */
export interface ApolloPhoneOnlyPerson {
  id: string
  name: string
  title?: string | null
  company?: string | null
  city?: string | null
  linkedin?: string | null
}
