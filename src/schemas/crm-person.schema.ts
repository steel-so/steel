import z from 'zod'
import { clearableText } from '@/src/schemas/clearable.schema'
import { CustomFieldsInputSchema } from '@/src/schemas/crm-custom-field.schema'
import { PhoneField } from '@/src/schemas/phone.schema'

export const CreateCrmPersonSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(200),
  emails: z.array(z.email()).default([]),
  phones: z.array(PhoneField).default([]),
  city: z.string().max(100).optional(),
  jobTitle: z.string().max(150).optional(),
  linkedin: z.string().max(300).optional(),
  avatar: z.string().max(500).optional(),
  companyId: z.string().optional(),
  customFields: CustomFieldsInputSchema.optional(),
})

export type CreateCrmPersonDTO = z.infer<typeof CreateCrmPersonSchema>

export const UpdateCrmPersonSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(200).optional(),
  emails: z.array(z.email()).optional(),
  phones: z.array(PhoneField).optional(),
  // Opcionais limpáveis: null (ou '') apaga o valor.
  city: clearableText(100),
  jobTitle: clearableText(150),
  linkedin: clearableText(300),
  avatar: clearableText(500),
  // Nullable: a coluna é limpável na grade (envia null para desvincular).
  companyId: z.string().nullable().optional(),
  customFields: CustomFieldsInputSchema.optional(),
})

export type UpdateCrmPersonDTO = z.infer<typeof UpdateCrmPersonSchema>

export const ListCrmPeopleSchema = z.object({
  companyId: z.string().optional(),
})

export type ListCrmPeopleDTO = z.infer<typeof ListCrmPeopleSchema>

export const ReorderCrmPeopleSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
})

export type ReorderCrmPeopleDTO = z.infer<typeof ReorderCrmPeopleSchema>
