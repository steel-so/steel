import z from 'zod'

export const SiteGlobalKindEnum = z.enum(['HEADER', 'FOOTER', 'SYMBOL'])

const DocumentSchema = z.record(z.string(), z.unknown())

export const CreateSiteGlobalSchema = z.object({
  kind: SiteGlobalKindEnum,
  name: z.string().trim().min(1, 'Nome é obrigatório').max(120),
  /** Optional: an empty document when absent. */
  document: DocumentSchema.optional(),
})

export type CreateSiteGlobalDTO = z.infer<typeof CreateSiteGlobalSchema>

export const UpdateSiteGlobalSchema = z
  .object({
    name: z.string().trim().min(1, 'Nome é obrigatório').max(120).optional(),
    document: DocumentSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nada para atualizar',
  })

export type UpdateSiteGlobalDTO = z.infer<typeof UpdateSiteGlobalSchema>
