import { z } from 'zod'

/** Status de fechamento ativos por workspace. */
export const WHATSAPP_CLOSE_STATUS_MAX = 50
export const WHATSAPP_CLOSE_STATUS_LABEL_MAX = 80
/** Teto do "máximo de status por fechamento" configurável. */
export const WHATSAPP_CLOSE_STATUS_MAX_SELECTIONS = 10

export const WHATSAPP_CLOSE_OUTCOMES = ['SUCCESS', 'FAILURE'] as const

const label = z
  .string()
  .trim()
  .min(1, 'Informe o nome do status')
  .max(
    WHATSAPP_CLOSE_STATUS_LABEL_MAX,
    `O nome pode ter até ${WHATSAPP_CLOSE_STATUS_LABEL_MAX} caracteres`,
  )

const outcome = z.enum(WHATSAPP_CLOSE_OUTCOMES, {
  message: 'Escolha se o status é de sucesso ou insucesso',
})

export const CreateWhatsAppCloseStatusSchema = z.object({
  label,
  outcome,
})

export type CreateWhatsAppCloseStatusDTO = z.infer<
  typeof CreateWhatsAppCloseStatusSchema
>

export const UpdateWhatsAppCloseStatusSchema = z
  .object({
    label: label.optional(),
    outcome: outcome.optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo para alterar',
  })

export type UpdateWhatsAppCloseStatusDTO = z.infer<
  typeof UpdateWhatsAppCloseStatusSchema
>
