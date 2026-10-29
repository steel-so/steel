import z from 'zod'

export const LookupCnpjSchema = z.object({
  cnpj: z.string().min(1, 'Informe o CNPJ').max(30),
})

export type LookupCnpjDTO = z.infer<typeof LookupCnpjSchema>

export const EnrichCompanySchema = z.object({
  /** Replaces the company name and address even when they are filled. */
  overwrite: z.boolean().default(false),
})

export type EnrichCompanyDTO = z.infer<typeof EnrichCompanySchema>

export const StartCnpjRunSchema = z.object({
  /** Skips companies that already have a Receita profile. */
  onlyMissing: z.boolean().default(true),
  /** Replaces the company name and address even when they are filled. */
  overwrite: z.boolean().default(false),
})

export type StartCnpjRunDTO = z.infer<typeof StartCnpjRunSchema>

export const ListCnpjRunsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

export type ListCnpjRunsDTO = z.infer<typeof ListCnpjRunsSchema>
