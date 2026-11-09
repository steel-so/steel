import z from 'zod'
import { CUSTOM_FIELD_TYPES } from '@/src/lib/custom-field-value'

const CustomFieldEntityEnum = z.enum(['COMPANY', 'PERSON', 'OPPORTUNITY'])
const CustomFieldTypeEnum = z.enum(CUSTOM_FIELD_TYPES)

const keyRegex = /^[a-z][a-z0-9_]*$/

export const CreateCrmCustomFieldSchema = z.object({
  entity: CustomFieldEntityEnum,
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(keyRegex, 'Chave deve começar com letra minúscula (snake_case)'),
  label: z.string().min(1, 'Rótulo é obrigatório').max(150),
  type: CustomFieldTypeEnum.default('TEXT'),
  options: z.array(z.string().max(100)).default([]),
  required: z.boolean().default(false),
})

export type CreateCrmCustomFieldDTO = z.infer<typeof CreateCrmCustomFieldSchema>

export const UpdateCrmCustomFieldSchema = z.object({
  label: z.string().min(1, 'Rótulo é obrigatório').max(150).optional(),
  type: CustomFieldTypeEnum.optional(),
  options: z.array(z.string().max(100)).optional(),
  required: z.boolean().optional(),
})

export type UpdateCrmCustomFieldDTO = z.infer<typeof UpdateCrmCustomFieldSchema>

export const ListCrmCustomFieldsSchema = z.object({
  entity: CustomFieldEntityEnum.optional(),
})

export type ListCrmCustomFieldsDTO = z.infer<typeof ListCrmCustomFieldsSchema>

export const ReorderCrmCustomFieldsSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
})

export type ReorderCrmCustomFieldsDTO = z.infer<
  typeof ReorderCrmCustomFieldsSchema
>

export const SetCrmCustomFieldValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
})

export type SetCrmCustomFieldValueDTO = z.infer<
  typeof SetCrmCustomFieldValueSchema
>

/** Mapa `definitionId -> valor bruto`, embutido no create/update de
 * Empresas/Pessoas/Oportunidades para escrever campos customizados. */
export const CustomFieldsInputSchema = z.record(z.string(), z.unknown())

export type CustomFieldsInputDTO = z.infer<typeof CustomFieldsInputSchema>
