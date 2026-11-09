import { z } from 'zod'
import { CUSTOM_FIELD_TYPES } from '@/src/lib/custom-field-value'

/** Max fields a workspace can define on its WhatsApp contacts. */
export const WHATSAPP_CONTACT_FIELD_LIMIT = 30

const OptionsField = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .refine((options) => new Set(options).size === options.length, {
    message: 'As opções não podem se repetir',
  })

export const CreateWhatsAppContactFieldSchema = z
  .object({
    label: z.string().trim().min(1, 'Informe o nome do campo').max(80),
    type: z.enum(CUSTOM_FIELD_TYPES).default('TEXT'),
    options: OptionsField.default([]),
    required: z.boolean().default(false),
  })
  .refine((data) => data.type !== 'SELECT' || data.options.length > 0, {
    message: 'Informe ao menos uma opção',
    path: ['options'],
  })

export type CreateWhatsAppContactFieldDTO = z.infer<
  typeof CreateWhatsAppContactFieldSchema
>

// The type is fixed after creation: changing it would orphan stored values.
export const UpdateWhatsAppContactFieldSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  options: OptionsField.optional(),
  required: z.boolean().optional(),
})

export type UpdateWhatsAppContactFieldDTO = z.infer<
  typeof UpdateWhatsAppContactFieldSchema
>

/** Map `definitionId -> raw value`, validated by the field's type. */
export const ContactCustomFieldsInputSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
)
