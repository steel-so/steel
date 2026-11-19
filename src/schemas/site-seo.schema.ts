import z from 'zod'

/** Tracked keywords per site (CRM > SEO). */
export const MAX_SEO_KEYWORDS_PER_SITE = 50

export const CreateSeoKeywordSchema = z.object({
  term: z
    .string()
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(2, 'Digite ao menos 2 caracteres')
        .max(100, 'Use até 100 caracteres'),
    ),
})

export type CreateSeoKeywordDTO = z.infer<typeof CreateSeoKeywordSchema>
