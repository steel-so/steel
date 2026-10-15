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
  /** `CONVERSION`: a CRM form was sent from the page (`formToken`). */
  kind: z.enum(['VIEW', 'CONVERSION']).default('VIEW'),
  formToken: z.string().trim().min(1).max(64).optional(),
  /** Signed CRM campaign link token (`stc`), attributed to the recipient. */
  ref: z.string().trim().max(200).optional(),
})

export type RecordSiteViewDTO = z.infer<typeof RecordSiteViewSchema>
