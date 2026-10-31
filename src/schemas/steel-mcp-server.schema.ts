import z from 'zod'

const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/

const baseFields = {
  name: z.string().trim().min(1, 'Informe o nome').max(60),
  url: z.string().trim().min(1, 'Informe a URL').max(500),
  authHeaderName: z
    .string()
    .trim()
    .regex(HEADER_NAME, 'Nome de cabeçalho inválido'),
  /** Write-only; `null`/empty clears it on update. */
  authValue: z.string().trim().max(2000).nullable(),
  enabled: z.boolean(),
  /** Remote tool names released to the agents. */
  allowedTools: z.array(z.string().trim().min(1).max(128)).max(100),
}

export const CreateSteelMcpServerSchema = z.object({
  ...baseFields,
  authHeaderName: baseFields.authHeaderName.default('Authorization'),
  authValue: baseFields.authValue.optional(),
  enabled: baseFields.enabled.default(true),
  allowedTools: baseFields.allowedTools.default([]),
})
export type CreateSteelMcpServerDTO = z.infer<typeof CreateSteelMcpServerSchema>

export const UpdateSteelMcpServerSchema = z
  .object(baseFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo',
  })
export type UpdateSteelMcpServerDTO = z.infer<typeof UpdateSteelMcpServerSchema>
