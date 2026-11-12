import z from 'zod'
import { PhoneField } from '@/src/schemas/phone.schema'

export const CreateCrmIntegrationKeySchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(150),
})

export type CreateCrmIntegrationKeyDTO = z.infer<
  typeof CreateCrmIntegrationKeySchema
>

/** Forma do payload externo. As regras de negócio (e-mail ou telefone
 * obrigatório, origem, dedupe) são aplicadas pelo `CrmLeadService.intake`
 * com o mesmo `CreateCrmLeadSchema` da criação manual. */
export const IngestCrmLeadSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(200),
  emails: z.array(z.email()).default([]),
  phones: z.array(PhoneField).default([]),
  company: z.string().max(200).optional(),
  jobTitle: z.string().max(150).optional(),
  city: z.string().max(100).optional(),
  linkedin: z.string().max(300).optional(),
  source: z.string().max(100).optional(),
  channel: z.string().max(100).optional(),
})

export type IngestCrmLeadDTO = z.infer<typeof IngestCrmLeadSchema>
