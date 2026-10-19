import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  crmApolloForbidden,
  crmApolloInvalidKey,
  crmApolloRateLimited,
  crmApolloRequestFailed,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type ApolloRateLimit,
  type ApolloSearchFilters,
  buildApolloSearchBody,
} from './apollo'

/**
 * Minimal Apollo.io REST client. The only place that talks to Apollo, so the
 * tests double it whole (`vi.mock('@/src/lib/integrations/apollo-client')`)
 * or mock `fetch`. Auth is the `x-api-key` header only (query-string keys are
 * deprecated) and the key never reaches a log or a response.
 *
 * Rate limits depend on the plan: they are read from the response headers and
 * handed to the caller, never hardcoded.
 */

const BASE_URL = 'https://api.apollo.io/api/v1'
const TIMEOUT_MS = 20_000

export interface ApolloReply<T> {
  data: T
  rateLimit: ApolloRateLimit
}

export interface ApolloPersonPreview {
  id: string
  firstName: string | null
  lastNameObfuscated: string | null
  title: string | null
  hasEmail: boolean
  hasDirectPhone: boolean
  organizationName: string | null
}

export interface ApolloSearchResult {
  totalEntries: number
  people: ApolloPersonPreview[]
}

export interface ApolloEnrichedPerson {
  id: string
  name: string
  firstName: string | null
  lastName: string | null
  email: string | null
  emailStatus: string | null
  title: string | null
  city: string | null
  state: string | null
  country: string | null
  linkedinUrl: string | null
  organizationName: string | null
  organizationDomain: string | null
  organizationWebsite: string | null
  organizationEmployees: number | null
  organizationIndustry: string | null
}

export interface ApolloBulkMatchResult {
  matches: Array<ApolloEnrichedPerson | null>
  creditsConsumed: number
}

export interface ApolloLabel {
  id: string
  name: string
  count: number
}

export interface ApolloContact {
  id: string
  name: string
  firstName: string | null
  lastName: string | null
  email: string | null
  emailStatus: string | null
  title: string | null
  organizationName: string | null
  linkedinUrl: string | null
  city: string | null
}

export interface ApolloContactsResult {
  contacts: ApolloContact[]
  totalEntries: number
  totalPages: number
}

type Raw = Record<string, unknown>

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const rec = (value: unknown): Raw =>
  value && typeof value === 'object' ? (value as Raw) : {}
const list = (value: unknown): Raw[] =>
  Array.isArray(value) ? value.map(rec) : []

function headerNumber(headers: Headers, name: string): number | null {
  const value = headers.get(name)
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function readRateLimit(headers: Headers): ApolloRateLimit {
  return {
    minuteLeft: headerNumber(headers, 'x-minute-requests-left'),
    hourLeft: headerNumber(headers, 'x-hourly-requests-left'),
    dayLeft: headerNumber(headers, 'x-24-hour-requests-left'),
  }
}

async function request<T>(
  key: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<Result<ApolloReply<T>>> {
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: init.method,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'x-api-key': key,
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    })
    if (!response.ok) {
      logger.warn(
        'integrations.apollo.request_failed',
        logFields(
          { component: 'ApolloClient' },
          { path: path.split('?')[0], status: response.status },
        ),
      )
      if (response.status === 401) return err(crmApolloInvalidKey())
      if (response.status === 403) return err(crmApolloForbidden())
      if (response.status === 429) {
        const retryAfter = headerNumber(response.headers, 'retry-after')
        return err(crmApolloRateLimited(retryAfter ?? undefined))
      }
      return err(
        crmApolloRequestFailed(
          `A Apollo recusou a chamada (${response.status})`,
        ),
      )
    }
    return ok({
      data: (await response.json()) as T,
      rateLimit: readRateLimit(response.headers),
    })
  } catch {
    logger.warn(
      'integrations.apollo.network_error',
      logFields({ component: 'ApolloClient' }, { path: path.split('?')[0] }),
    )
    return err(crmApolloRequestFailed())
  }
}

export const ApolloClient = {
  /** Validates the key ("Testar conexão" and on save). */
  async health(
    key: string,
  ): Promise<Result<ApolloReply<{ healthy: boolean }>>> {
    const result = await request<Raw>(key, '/auth/health', { method: 'GET' })
    if (!result.ok) return result
    const healthy =
      result.value.data.healthy === true &&
      result.value.data.is_logged_in !== false
    if (!healthy) return err(crmApolloInvalidKey())
    return ok({ data: { healthy }, rateLimit: result.value.rateLimit })
  },

  /** People search — 0 credits, no e-mail or phone in the answer. */
  async searchPeople(
    key: string,
    filters: ApolloSearchFilters,
    page: number,
    perPage: number,
  ): Promise<Result<ApolloReply<ApolloSearchResult>>> {
    const result = await request<Raw>(key, '/mixed_people/api_search', {
      method: 'POST',
      body: buildApolloSearchBody(filters, page, perPage),
    })
    if (!result.ok) return result
    const raw = result.value.data
    return ok({
      rateLimit: result.value.rateLimit,
      data: {
        totalEntries: num(raw.total_entries) ?? 0,
        people: list(raw.people).map((p) => ({
          id: String(p.id ?? ''),
          firstName: str(p.first_name),
          lastNameObfuscated: str(p.last_name_obfuscated),
          title: str(p.title),
          hasEmail: p.has_email === true,
          hasDirectPhone: p.has_direct_phone === true,
          organizationName: str(rec(p.organization).name),
        })),
      },
    })
  },

  /**
   * Enrichment: ~1 credit per matched person, max 10 ids per call. Personal
   * e-mails are never revealed (LGPD).
   */
  async bulkMatch(
    key: string,
    ids: string[],
  ): Promise<Result<ApolloReply<ApolloBulkMatchResult>>> {
    const result = await request<Raw>(
      key,
      '/people/bulk_match?reveal_personal_emails=false',
      { method: 'POST', body: { details: ids.map((id) => ({ id })) } },
    )
    if (!result.ok) return result
    const raw = result.value.data
    const matches = Array.isArray(raw.matches) ? raw.matches : []
    return ok({
      rateLimit: result.value.rateLimit,
      data: {
        creditsConsumed: num(raw.credits_consumed) ?? 0,
        matches: matches.map((entry): ApolloEnrichedPerson | null => {
          const p = rec(entry)
          if (!str(p.id)) return null
          const org = rec(p.organization)
          return {
            id: String(p.id),
            name:
              str(p.name) ??
              [str(p.first_name), str(p.last_name)].filter(Boolean).join(' '),
            firstName: str(p.first_name),
            lastName: str(p.last_name),
            email: str(p.email),
            emailStatus: str(p.email_status),
            title: str(p.title),
            city: str(p.city),
            state: str(p.state),
            country: str(p.country),
            linkedinUrl: str(p.linkedin_url),
            organizationName: str(org.name),
            organizationDomain: str(org.primary_domain),
            organizationWebsite: str(org.website_url),
            organizationEmployees: num(org.estimated_num_employees),
            organizationIndustry: str(org.industry),
          }
        }),
      },
    })
  },

  /** Saved lists of the account (needs a master key: 403 otherwise). */
  async listLabels(key: string): Promise<Result<ApolloReply<ApolloLabel[]>>> {
    const result = await request<unknown>(key, '/labels', { method: 'GET' })
    if (!result.ok) return result
    return ok({
      rateLimit: result.value.rateLimit,
      data: list(result.value.data).map((l) => ({
        id: String(l.id ?? ''),
        name: str(l.name) ?? 'Lista sem nome',
        count: num(l.cached_count) ?? 0,
      })),
    })
  },

  /** Contacts already saved in a list — 0 credits, e-mail included. */
  async searchContacts(
    key: string,
    labelId: string,
    page: number,
    perPage: number,
  ): Promise<Result<ApolloReply<ApolloContactsResult>>> {
    const result = await request<Raw>(key, '/contacts/search', {
      method: 'POST',
      body: { contact_label_ids: [labelId], page, per_page: perPage },
    })
    if (!result.ok) return result
    const raw = result.value.data
    const pagination = rec(raw.pagination)
    return ok({
      rateLimit: result.value.rateLimit,
      data: {
        totalEntries: num(pagination.total_entries) ?? 0,
        totalPages: num(pagination.total_pages) ?? 0,
        contacts: list(raw.contacts).map((c) => ({
          id: String(c.id ?? ''),
          name:
            str(c.name) ??
            [str(c.first_name), str(c.last_name)].filter(Boolean).join(' '),
          firstName: str(c.first_name),
          lastName: str(c.last_name),
          email: str(c.email),
          emailStatus: str(c.email_status),
          title: str(c.title),
          organizationName: str(c.organization_name),
          linkedinUrl: str(c.linkedin_url),
          city: str(c.city),
        })),
      },
    })
  },
}
