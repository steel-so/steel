import z from 'zod'
import {
  isValidRedirectTarget,
  normalizeRedirectSource,
} from '@/src/lib/sites/redirects'

/** Old address: `/antigo` or a prefix `/blog/*` (normalized to lower case,
 * without query or trailing slash). */
export const SiteRedirectSourceSchema = z
  .string()
  .trim()
  .min(1, 'Informe o endereço antigo')
  .max(500)
  .transform((value, ctx) => {
    const source = normalizeRedirectSource(value)
    if (!source) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Use um caminho como /antigo ou /blog/* (letras minúsculas, números e hífens)',
      })
      return z.NEVER
    }
    return source
  })

/** New address: a path of the site (`/novo`) or a full URL. */
export const SiteRedirectTargetSchema = z
  .string()
  .trim()
  .min(1, 'Informe o novo endereço')
  .max(2000)
  .refine(isValidRedirectTarget, {
    message: 'Use um caminho do site (/novo) ou um endereço https://',
  })

export const CreateSiteRedirectSchema = z.object({
  fromPath: SiteRedirectSourceSchema,
  toPath: SiteRedirectTargetSchema,
  /** `true` (default): permanent (search engines move the ranking). */
  permanent: z.boolean().default(true),
})

export type CreateSiteRedirectDTO = z.infer<typeof CreateSiteRedirectSchema>

export const UpdateSiteRedirectSchema = z
  .object({
    fromPath: SiteRedirectSourceSchema.optional(),
    toPath: SiteRedirectTargetSchema.optional(),
    permanent: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nada para atualizar',
  })

export type UpdateSiteRedirectDTO = z.infer<typeof UpdateSiteRedirectSchema>
