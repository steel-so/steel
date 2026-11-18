import z from 'zod'

/**
 * Data sources of the Comunicação (WhatsApp) dashboards. Each one answers
 * flattened rows (pt-BR labels + derived fields) that the CRM widget engine
 * aggregates in the browser. See `types/whatsapp-dashboard.d.ts`.
 */
export const WA_DASHBOARD_SOURCES = [
  'whatsapp-ai-campaign-recipients',
  'whatsapp-messages',
  'whatsapp-broadcast-recipients',
  'whatsapp-templates',
  'whatsapp-costs',
  'whatsapp-ai-campaign-actions',
] as const

export type WaDashboardSource = (typeof WA_DASHBOARD_SOURCES)[number]

export const WaDashboardSourceSchema = z.enum(WA_DASHBOARD_SOURCES, {
  error: 'Fonte de dados desconhecida',
})

/** Params of `GET .../whatsapp/dashboards/sources/[source]`. */
export const WaDashboardSourceParamsSchema = z.object({
  source: WaDashboardSourceSchema,
})

/**
 * History window of the sources. 400 days cover "current year" and the
 * 30-day comparison with room to spare.
 */
export const WA_DASHBOARD_HISTORY_DAYS = 400

/** Row ceiling per source (widgets aggregate in the browser). */
export const WA_DASHBOARD_ROW_LIMITS: Record<WaDashboardSource, number> = {
  'whatsapp-ai-campaign-recipients': 20_000,
  'whatsapp-messages': 20_000,
  'whatsapp-broadcast-recipients': 20_000,
  'whatsapp-templates': 5_000,
  'whatsapp-costs': 20_000,
  'whatsapp-ai-campaign-actions': 20_000,
}
