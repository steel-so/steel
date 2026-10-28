import { z } from 'zod'
import { canvasColorSchema, responsiveSchema } from '@/src/lib/canvas/values'
import { commonShape } from './schemas'
import { SITE_BUTTON_VARIANTS } from './theme'

/**
 * Props of the newsletter elements of the site catalog (ADR 0054, slice
 * nl-archive): `site.newsletter-subscribe` and `site.newsletter-issues`.
 * Both point to a CRM newsletter by id; the runtime resolves the live data
 * (`SiteRenderContext.newsletters`), the name is only a snapshot for the
 * editor when the newsletter is gone.
 */

const resp = responsiveSchema

/** cuid of a CRM newsletter, `''` until one is picked. */
const newsletterIdSchema = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]*$/)

export const SITE_NEWSLETTER_ISSUES_LAYOUTS = ['list', 'cards'] as const

export const siteNewsletterSubscribeSchema = z.object({
  newsletterId: newsletterIdSchema,
  newsletterName: z.string().max(120),
  /** Line above the fields (`''` hides it). */
  title: z.string().max(120),
  /** Optional name field. */
  showName: z.boolean(),
  submitLabel: z.string().max(80),
  /** `inline`: e-mail and button side by side (stacks on mobile). */
  layout: resp(z.enum(['stacked', 'inline'])),
  buttonVariant: z.enum(SITE_BUTTON_VARIANTS),
  fieldBackground: canvasColorSchema.optional(),
  ...commonShape,
})
export type SiteNewsletterSubscribeProps = z.infer<
  typeof siteNewsletterSubscribeSchema
>

export const siteNewsletterIssuesSchema = z.object({
  newsletterId: newsletterIdSchema,
  newsletterName: z.string().max(120),
  /** Latest N SENT issues (the runtime loads at most 12). */
  count: z.number().int().min(1).max(12),
  layout: z.enum(SITE_NEWSLETTER_ISSUES_LAYOUTS),
  columns: resp(z.enum(['1', '2', '3'])),
  showNumber: z.boolean(),
  showDate: z.boolean(),
  showExcerpt: z.boolean(),
  /** "Ver todas as edições" → the public archive. */
  showArchiveLink: z.boolean(),
  archiveLinkLabel: z.string().max(80),
  emptyText: z.string().max(200),
  accentColor: canvasColorSchema.optional(),
  cardBackground: canvasColorSchema.optional(),
  ...commonShape,
})
export type SiteNewsletterIssuesProps = z.infer<
  typeof siteNewsletterIssuesSchema
>
