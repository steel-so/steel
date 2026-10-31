/**
 * Major-incident rules that need no I/O: labels, the overall status of a
 * status page, slugs and the text of the notices.
 */

export const SD_MAJOR_INCIDENT_STATUSES = [
  'INVESTIGATING',
  'IDENTIFIED',
  'MONITORING',
  'RESOLVED',
] as const
export type SdMajorIncidentStatusValue =
  (typeof SD_MAJOR_INCIDENT_STATUSES)[number]

export const SD_MAJOR_INCIDENT_IMPACTS = [
  'DEGRADED',
  'PARTIAL_OUTAGE',
  'MAJOR_OUTAGE',
] as const
export type SdMajorIncidentImpactValue =
  (typeof SD_MAJOR_INCIDENT_IMPACTS)[number]

/** What a status page shows when no incident is active. */
export type SdStatusPageOverall = 'OPERATIONAL' | SdMajorIncidentImpactValue

export const SD_MAJOR_INCIDENT_STATUS_LABEL: Record<
  SdMajorIncidentStatusValue,
  string
> = {
  INVESTIGATING: 'Investigando',
  IDENTIFIED: 'Causa identificada',
  MONITORING: 'Monitorando',
  RESOLVED: 'Resolvido',
}

export const SD_MAJOR_INCIDENT_IMPACT_LABEL: Record<
  SdMajorIncidentImpactValue,
  string
> = {
  DEGRADED: 'Desempenho degradado',
  PARTIAL_OUTAGE: 'Indisponibilidade parcial',
  MAJOR_OUTAGE: 'Indisponibilidade total',
}

export const SD_STATUS_PAGE_OVERALL_LABEL: Record<SdStatusPageOverall, string> =
  {
    OPERATIONAL: 'Todos os sistemas operando normalmente',
    ...SD_MAJOR_INCIDENT_IMPACT_LABEL,
  }

const IMPACT_RANK: Record<SdMajorIncidentImpactValue, number> = {
  DEGRADED: 1,
  PARTIAL_OUTAGE: 2,
  MAJOR_OUTAGE: 3,
}

/**
 * Worst impact among the active incidents of a page and its components: a
 * degraded component counts as `DEGRADED`, a component in outage as
 * `PARTIAL_OUTAGE` (or `MAJOR_OUTAGE` when every component is down).
 */
export function sdStatusPageOverall(
  activeImpacts: SdMajorIncidentImpactValue[],
  componentStates: ('OPERATIONAL' | 'DEGRADED' | 'OUTAGE')[] = [],
): SdStatusPageOverall {
  const impacts = [...activeImpacts]
  const outages = componentStates.filter((s) => s === 'OUTAGE').length
  if (outages > 0) {
    impacts.push(
      outages === componentStates.length ? 'MAJOR_OUTAGE' : 'PARTIAL_OUTAGE',
    )
  }
  if (componentStates.includes('DEGRADED')) impacts.push('DEGRADED')
  let worst: SdMajorIncidentImpactValue | null = null
  for (const impact of impacts) {
    if (!worst || IMPACT_RANK[impact] > IMPACT_RANK[worst]) worst = impact
  }
  return worst ?? 'OPERATIONAL'
}

/** Days of resolved incidents the public page keeps showing. */
export const SD_STATUS_PAGE_HISTORY_DAYS = 30

/** Max child tickets linked in one call. */
export const SD_MAJOR_INCIDENT_MAX_LINK_BATCH = 100

/** Max child tickets resolved in one call when the incident resolves. */
export const SD_MAJOR_INCIDENT_MAX_RESOLVE_BATCH = 200

/** Suggestions window (hours back) and size. */
export const SD_MAJOR_INCIDENT_SUGGEST_HOURS = 24
export const SD_MAJOR_INCIDENT_SUGGEST_LIMIT = 30

/** Subscribers notified per update; the rest is skipped and counted. */
export const SD_STATUS_NOTIFY_MAX_SUBSCRIBERS = 2000

/** Pause between WhatsApp sends of one update (provider rate limits). */
export const SD_STATUS_WHATSAPP_GAP_MS = 250

/** `acme-ti` -> valid slug; empty when nothing usable is left. */
export function sdStatusPageSlugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export const SD_STATUS_PAGE_SLUG_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/

/** Slug with a random suffix, used when the admin does not choose one. */
export function sdStatusPageAutoSlug(name: string, random: string): string {
  const base = sdStatusPageSlugify(name) || 'status'
  return `${base.slice(0, 38)}-${random}`
}

export function sdNormalizeStatusEmail(value: string): string {
  return value.trim().toLowerCase()
}

/** Plain-text notice (WhatsApp body and e-mail preview). */
export function sdStatusUpdateText(input: {
  pageName: string
  incidentTitle: string
  status: SdMajorIncidentStatusValue
  message: string
  url: string
}): string {
  return [
    `*${input.pageName}* — ${input.incidentTitle}`,
    `Situação: ${SD_MAJOR_INCIDENT_STATUS_LABEL[input.status]}`,
    '',
    input.message,
    '',
    `Acompanhe: ${input.url}`,
  ].join('\n')
}

/** Path of the public page (relative to the app URL). */
export function sdStatusPagePath(slug: string): string {
  return `/status-page/${slug}`
}

/** Path of the confirmation / unsubscribe page of a subscriber. */
export function sdStatusSubscriptionPath(slug: string, token: string): string {
  return `/status-page/${slug}/inscricao/${token}`
}

/**
 * Whether a status page should be preselected for a master ticket: pages
 * without scope (no customer, no services) cover everything; scoped pages
 * match by customer/company or by any catalog level of the ticket.
 */
export function sdPageMatchesTicket(
  page: { customerId: string | null; serviceIds: string[] },
  ticket: {
    customerId: string | null
    companyId: string | null
    serviceId: string | null
    categoryId: string | null
    subcategoryId: string | null
  },
): boolean {
  if (!page.customerId && page.serviceIds.length === 0) return true
  if (
    page.customerId &&
    (page.customerId === ticket.customerId ||
      page.customerId === ticket.companyId)
  ) {
    return true
  }
  const levels = [ticket.serviceId, ticket.categoryId, ticket.subcategoryId]
  return levels.some((id) => id !== null && page.serviceIds.includes(id))
}

/** Default first public message of a declared incident. */
export const SD_MAJOR_INCIDENT_DEFAULT_MESSAGE =
  'Identificamos um problema e já estamos investigando. Voltamos com novidades em breve.'
