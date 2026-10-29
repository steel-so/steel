import z from 'zod'
import { clearableText } from '@/src/schemas/clearable.schema'
import { SteelAgentMentionsSchema } from '@/src/schemas/steel-agent.schema'

export const CreateCrmNoteSchema = z.object({
  title: z.string().max(200).optional(),
  body: z.string().max(20000).optional(),
  companyId: z.string().optional(),
  personId: z.string().optional(),
  opportunityId: z.string().optional(),
  /** Steel Agents citados com `@` na nota (acorda cada agente). */
  mentionedAgentIds: SteelAgentMentionsSchema,
})

export type CreateCrmNoteDTO = z.infer<typeof CreateCrmNoteSchema>

export const UpdateCrmNoteSchema = z.object({
  // Opcionais limpáveis: null (ou '') apaga o valor.
  title: clearableText(200),
  body: clearableText(20000),
  // Nullable: colunas limpáveis na grade (enviam null para desvincular).
  companyId: z.string().nullable().optional(),
  personId: z.string().nullable().optional(),
  opportunityId: z.string().nullable().optional(),
})

export type UpdateCrmNoteDTO = z.infer<typeof UpdateCrmNoteSchema>

export const ListCrmNotesSchema = z.object({
  companyId: z.string().optional(),
  personId: z.string().optional(),
  opportunityId: z.string().optional(),
})

export type ListCrmNotesDTO = z.infer<typeof ListCrmNotesSchema>

export const ReorderCrmNotesSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
})

export type ReorderCrmNotesDTO = z.infer<typeof ReorderCrmNotesSchema>
