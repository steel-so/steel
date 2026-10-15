import z from 'zod'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Longest range a metrics query may cover, in days. */
export const SITE_ANALYTICS_MAX_DAYS = 366

/** `YYYY-MM-DD` that is a real calendar day. */
export const SiteAnalyticsDaySchema = z
  .string()
  .regex(ISO_DAY, 'Use o formato AAAA-MM-DD')
  .refine(
    (value) => {
      const date = new Date(`${value}T00:00:00Z`)
      return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      )
    },
    { message: 'Data inválida' },
  )

/** Days between two `YYYY-MM-DD` values, both included. */
export function daysInRange(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000) + 1
}

/** Metrics of one site over a range of days in the site's timezone. Both
 * ends are optional: the default is the last 30 days. */
export const SiteAnalyticsQuerySchema = z
  .object({
    from: SiteAnalyticsDaySchema.optional(),
    to: SiteAnalyticsDaySchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'A data inicial deve vir antes da final',
    path: ['from'],
  })
  .refine(
    (value) =>
      !value.from ||
      !value.to ||
      daysInRange(value.from, value.to) <= SITE_ANALYTICS_MAX_DAYS,
    {
      message: `O período pode ter até ${SITE_ANALYTICS_MAX_DAYS} dias`,
      path: ['to'],
    },
  )

export type SiteAnalyticsQueryDTO = z.infer<typeof SiteAnalyticsQuerySchema>

/** Daily views of every site of the workspace (list sparklines). */
export const SiteAnalyticsSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(14),
})

export type SiteAnalyticsSummaryQueryDTO = z.infer<
  typeof SiteAnalyticsSummaryQuerySchema
>
