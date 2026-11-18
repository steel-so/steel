import z from 'zod'

/**
 * Data sources of the Comunicação (WhatsApp) dashboards. Each one answers
 * flattened rows (pt-BR labels + derived fields) that the CRM widget engine
 * aggregates in the browser. See `types/whatsapp-dashboard.d.ts`.
 */
export const WA_DASHBOARD_SOURCES = [
  'whatsapp-ai-campaign-recipients',
  'whatsapp-attendances',
  'whatsapp-conversation-events',
  'whatsapp-sla-cycles',
  'whatsapp-team-members',
  'whatsapp-messages',
  'whatsapp-broadcast-recipients',
  'whatsapp-templates',
  'whatsapp-costs',
  'whatsapp-ai-campaign-actions',
  // Channels — see `types/whatsapp-dashboard-channels.d.ts`.
  'whatsapp-calls',
  'whatsapp-charges',
  'whatsapp-appointments',
  'whatsapp-chatbot-sessions',
  'whatsapp-flow-responses',
  'whatsapp-ad-referrals',
  'whatsapp-ad-spends',
  'whatsapp-contacts',
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
  'whatsapp-attendances': 20_000,
  'whatsapp-conversation-events': 20_000,
  'whatsapp-sla-cycles': 20_000,
  // Current state (no history window): one row per team membership.
  'whatsapp-team-members': 2_000,
  'whatsapp-messages': 20_000,
  'whatsapp-broadcast-recipients': 20_000,
  'whatsapp-templates': 5_000,
  'whatsapp-costs': 20_000,
  'whatsapp-ai-campaign-actions': 20_000,
  'whatsapp-calls': 20_000,
  'whatsapp-charges': 20_000,
  'whatsapp-appointments': 20_000,
  'whatsapp-chatbot-sessions': 20_000,
  'whatsapp-flow-responses': 20_000,
  'whatsapp-ad-referrals': 20_000,
  'whatsapp-ad-spends': 5_000,
  'whatsapp-contacts': 20_000,
}
