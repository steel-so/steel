import z from 'zod'

const utm = z.string().trim().max(120).optional()

/** Beacon of the public runtime. No PII: the visitor is a server-side hash
 * and the referrer keeps only its host. */
export const RecordSiteViewSchema = z.object({
  pageId: z.string().min(1).max(40).optional(),
  path: z.string().trim().max(500).default(''),
  referrer: z.string().trim().max(2000).optional(),
  utmSource: utm,
  utmMedium: utm,
  utmCampaign: utm,
  utmTerm: utm,
  utmContent: utm,
})

export type RecordSiteViewDTO = z.infer<typeof RecordSiteViewSchema>
