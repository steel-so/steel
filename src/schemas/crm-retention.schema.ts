import z from 'zod'

export const CRM_RETENTION_DUE_DAYS_MIN = 1
export const CRM_RETENTION_DUE_DAYS_MAX = 30

/**
 * Defaults of the retention follow-up. A workspace without a row in
 * `crm_retention_settings` uses exactly these (mirrored in the model's
 * `@default`s).
 */
export const CRM_RETENTION_DEFAULTS = {
  onDetractor: true,
  onHealthDrop: true,
  createOpportunity: false,
  taskDueDays: 2,
} as const satisfies {
  onDetractor: boolean
  onHealthDrop: boolean
  createOpportunity: boolean
  taskDueDays: number
}

export const UpdateCrmRetentionSettingsSchema = z
  .object({
    onDetractor: z.boolean().optional(),
    onHealthDrop: z.boolean().optional(),
    createOpportunity: z.boolean().optional(),
    taskDueDays: z
      .number()
      .int('Informe um número inteiro de dias')
      .min(
        CRM_RETENTION_DUE_DAYS_MIN,
        `O prazo mínimo é de ${CRM_RETENTION_DUE_DAYS_MIN} dia`,
      )
      .max(
        CRM_RETENTION_DUE_DAYS_MAX,
        `O prazo máximo é de ${CRM_RETENTION_DUE_DAYS_MAX} dias`,
      )
      .optional(),
  })
  .refine((dto) => Object.values(dto).some((value) => value !== undefined), {
    message: 'Informe ao menos uma configuração',
  })

export type UpdateCrmRetentionSettingsDTO = z.infer<
  typeof UpdateCrmRetentionSettingsSchema
>
