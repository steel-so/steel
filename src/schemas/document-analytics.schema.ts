import z from 'zod'

/**
 * Reading analytics of CRM > Documentos (ADR 0063). The beacon itself is
 * `DocumentTrackSchema` (document.schema.ts); this is the panel query.
 */

export const DOCUMENT_ANALYTICS_PERIODS = ['7', '30', '90', 'all'] as const
export type DocumentAnalyticsPeriod =
  (typeof DOCUMENT_ANALYTICS_PERIODS)[number]

/** `?days=7|30|90|all` — defaults to every session (`all`). */
export const DocumentAnalyticsQuerySchema = z.object({
  days: z.enum(DOCUMENT_ANALYTICS_PERIODS).default('all'),
})
export type DocumentAnalyticsQuery = z.infer<
  typeof DocumentAnalyticsQuerySchema
>

/** Days covered by a period, `null` for `all`. */
export function documentAnalyticsPeriodDays(
  period: DocumentAnalyticsPeriod,
): number | null {
  return period === 'all' ? null : Number(period)
}
