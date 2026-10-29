import z from 'zod'

/**
 * Subject A/B test of a newsletter issue (newsletter2 nl2-digest-ai): a
 * second subject goes to half of a test share of the audience; after the
 * wait the variant with the better open (or click) rate goes to the rest.
 */

export const CRM_NEWSLETTER_AB_METRICS = ['OPENS', 'CLICKS'] as const
export type CrmNewsletterAbMetricValue =
  (typeof CRM_NEWSLETTER_AB_METRICS)[number]

/** Smallest audience a test runs on (each variant gets ≥ 1 e-mail). */
export const CRM_NEWSLETTER_AB_MIN_AUDIENCE = 20
export const CRM_NEWSLETTER_AB_MIN_PERCENT = 10
export const CRM_NEWSLETTER_AB_MAX_PERCENT = 50
export const CRM_NEWSLETTER_AB_MAX_WAIT_HOURS = 72

export const SetCrmNewsletterAbTestSchema = z.object({
  subjectB: z
    .string()
    .trim()
    .min(1, 'Informe o assunto da variante B')
    .max(200),
  testPercent: z
    .number()
    .int()
    .min(CRM_NEWSLETTER_AB_MIN_PERCENT)
    .max(CRM_NEWSLETTER_AB_MAX_PERCENT)
    .default(20),
  metric: z.enum(CRM_NEWSLETTER_AB_METRICS).default('OPENS'),
  waitHours: z
    .number()
    .int()
    .min(1)
    .max(CRM_NEWSLETTER_AB_MAX_WAIT_HOURS)
    .default(4),
})
export type SetCrmNewsletterAbTestDTO = z.infer<
  typeof SetCrmNewsletterAbTestSchema
>

export type CrmNewsletterAbTestDTO = {
  subjectB: string
  testPercent: number
  metric: CrmNewsletterAbMetricValue
  waitHours: number
  winner: 'A' | 'B' | null
  decidedAt: string | null
  /** When the winner is picked (null until sending starts). */
  decideAt: string | null
}

export type CrmNewsletterAbVariantStatsDTO = {
  variant: 'A' | 'B'
  subject: string
  recipients: number
  sent: number
  opened: number
  clicked: number
  openRate: number | null
  clickRate: number | null
}

/** GET …/ab-test: settings and, once sending started, the variant stats. */
export type CrmNewsletterAbReportDTO = {
  subjectA: string
  abTest: CrmNewsletterAbTestDTO | null
  variants: CrmNewsletterAbVariantStatsDTO[]
  /** Recipients still waiting for the winner. */
  held: number
}
