import { z } from 'zod'

export const UpdateMetaChannelSettingsSchema = z
  .object({
    coexistenceEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos uma configuração',
  })

export type UpdateMetaChannelSettingsDTO = z.infer<
  typeof UpdateMetaChannelSettingsSchema
>
