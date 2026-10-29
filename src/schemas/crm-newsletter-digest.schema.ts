import z from 'zod'

/**
 * "Resumo automático" of a newsletter (newsletter2 nl2-digest-ai, ADR
 * 0054 phase 2): the new posts of a Site blog and/or an external RSS/Atom
 * feed, weekly or monthly at a whole hour in America/Sao_Paulo, as a
 * draft issue or sent right away.
 */

export const CRM_NEWSLETTER_DIGEST_CADENCES = ['WEEKLY', 'MONTHLY'] as const
export type CrmNewsletterDigestCadenceValue =
  (typeof CRM_NEWSLETTER_DIGEST_CADENCES)[number]

export const CRM_NEWSLETTER_DIGEST_MODES = ['DRAFT', 'AUTO_SEND'] as const
export type CrmNewsletterDigestModeValue =
  (typeof CRM_NEWSLETTER_DIGEST_MODES)[number]

export const CRM_NEWSLETTER_DIGEST_OUTCOMES = [
  'DRAFT_CREATED',
  'SENT',
  'SKIPPED',
  'FAILED',
] as const
export type CrmNewsletterDigestOutcome =
  (typeof CRM_NEWSLETTER_DIGEST_OUTCOMES)[number]

export const CRM_NEWSLETTER_DIGEST_MAX_ITEMS = 12
export const CRM_NEWSLETTER_DIGEST_DEFAULT_SUBJECT = 'Resumo de {data}'

const rssUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:'
    } catch {
      return false
    }
  }, 'Informe o endereço https:// do feed RSS ou Atom')

const DigestSettingsObject = z.object({
  enabled: z.boolean().default(true),
  siteId: z.string().trim().min(1).max(40).nullable().default(null),
  rssUrl: rssUrl.nullable().default(null),
  cadence: z.enum(CRM_NEWSLETTER_DIGEST_CADENCES).default('WEEKLY'),
  /** 0 = domingo … 6 = sábado. */
  weekday: z.number().int().min(0).max(6).nullable().default(1),
  /** 1..28. */
  monthDay: z.number().int().min(1).max(28).nullable().default(null),
  hour: z.number().int().min(0).max(23).default(9),
  mode: z.enum(CRM_NEWSLETTER_DIGEST_MODES).default('DRAFT'),
  maxItems: z
    .number()
    .int()
    .min(1)
    .max(CRM_NEWSLETTER_DIGEST_MAX_ITEMS)
    .default(5),
  subject: z
    .string()
    .trim()
    .min(1, 'Assunto é obrigatório')
    .max(200)
    .default(CRM_NEWSLETTER_DIGEST_DEFAULT_SUBJECT),
  intro: z.string().trim().max(2000).nullable().default(null),
})

function checkSettings(
  value: z.infer<typeof DigestSettingsObject>,
  ctx: z.RefinementCtx,
) {
  if (!value.siteId && !value.rssUrl) {
    ctx.addIssue({
      code: 'custom',
      path: ['siteId'],
      message: 'Escolha um blog do Sites, um feed RSS ou os dois',
    })
  }
  if (value.cadence === 'WEEKLY' && value.weekday === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['weekday'],
      message: 'Escolha o dia da semana',
    })
  }
  if (value.cadence === 'MONTHLY' && value.monthDay === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['monthDay'],
      message: 'Escolha o dia do mês (1 a 28)',
    })
  }
}

/** PUT …/digest: the whole settings (create or replace). */
export const UpsertCrmNewsletterDigestSchema =
  DigestSettingsObject.superRefine(checkSettings)
export type UpsertCrmNewsletterDigestDTO = z.infer<
  typeof UpsertCrmNewsletterDigestSchema
>

/** POST …/digest/preview: just the sources and how many items. */
export const PreviewCrmNewsletterDigestSchema = z
  .object({
    siteId: DigestSettingsObject.shape.siteId,
    rssUrl: DigestSettingsObject.shape.rssUrl,
    maxItems: DigestSettingsObject.shape.maxItems,
  })
  .superRefine((value, ctx) => {
    if (!value.siteId && !value.rssUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['siteId'],
        message: 'Escolha um blog do Sites, um feed RSS ou os dois',
      })
    }
  })
export type PreviewCrmNewsletterDigestDTO = z.infer<
  typeof PreviewCrmNewsletterDigestSchema
>

export type CrmNewsletterDigestDTO = {
  id: string
  newsletterId: string
  enabled: boolean
  siteId: string | null
  siteName: string | null
  rssUrl: string | null
  cadence: CrmNewsletterDigestCadenceValue
  weekday: number | null
  monthDay: number | null
  hour: number
  mode: CrmNewsletterDigestModeValue
  maxItems: number
  subject: string
  intro: string | null
  nextRunAt: string | null
  lastRunAt: string | null
  lastItemAt: string | null
  lastIssueId: string | null
  lastOutcome: CrmNewsletterDigestOutcome | null
  lastMessage: string | null
  updatedAt: string
}

/** Sites of the workspace whose blog the digest can read. */
export type CrmNewsletterDigestSiteDTO = {
  id: string
  name: string
  published: boolean
}

/** GET …/digest: the settings (null = never configured) and the sites. */
export type CrmNewsletterDigestSettingsDTO = {
  digest: CrmNewsletterDigestDTO | null
  sites: CrmNewsletterDigestSiteDTO[]
}

export type CrmNewsletterDigestItemDTO = {
  source: 'SITE' | 'RSS'
  title: string
  excerpt: string
  url: string
  imageUrl: string | null
  publishedAt: string | null
}

/** POST …/digest/preview: what the next digest would carry. */
export type CrmNewsletterDigestPreviewDTO = {
  items: CrmNewsletterDigestItemDTO[]
  /** pt-BR problems with a source (feed unreachable…); items may still come. */
  warnings: string[]
  /** Items newer than this go in (null = first digest's look-back). */
  since: string
}

/** POST …/digest/run: the draft created now. */
export type CrmNewsletterDigestRunDTO = {
  issueId: string | null
  items: number
  message: string
}
