import z from 'zod'

/**
 * Data sources of the CRM dashboards that serve flattened rows (names
 * resolved, derived booleans and day counts) instead of the plain list
 * endpoints. Served by `GET .../crm/dashboards/sources/[source]`; the widget
 * engine aggregates them in the browser. See `types/crm-dashboard-source.d.ts`.
 */
export const CRM_DASHBOARD_SOURCES = [
  'crm-proposals',
  'crm-contracts',
  'crm-charges',
  'crm-activities',
  'crm-quotas',
  'crm-health',
  'crm-campaigns',
] as const

export type CrmDashboardSource = (typeof CRM_DASHBOARD_SOURCES)[number]

export const CrmDashboardSourceSchema = z.enum(CRM_DASHBOARD_SOURCES, {
  error: 'Fonte de dados desconhecida',
})

/** Params of `GET .../crm/dashboards/sources/[source]`. */
export const CrmDashboardSourceParamsSchema = z.object({
  source: CrmDashboardSourceSchema,
})

/** History window of the sources that have one (400 days cover "this year"). */
export const CRM_DASHBOARD_HISTORY_DAYS = 400

/** Row ceiling per source (widgets aggregate in the browser). */
export const CRM_DASHBOARD_ROW_LIMITS: Record<CrmDashboardSource, number> = {
  'crm-proposals': 10_000,
  'crm-contracts': 10_000,
  'crm-charges': 10_000,
  'crm-activities': 20_000,
  // Current state (no window): one row per owner and period.
  'crm-quotas': 5_000,
  // Current state: one row per company / open deal.
  'crm-health': 10_000,
  'crm-campaigns': 5_000,
}
