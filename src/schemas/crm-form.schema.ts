import z from 'zod'
import { CrmCampaignRefSchema } from './crm-campaign.schema'

export const FORM_ACTIONS = ['COMPANY', 'PERSON', 'LEAD'] as const
export type CrmFormActionType = (typeof FORM_ACTIONS)[number]

export const FORM_FIELD_TYPES = [
  'text',
  'email',
  'phone',
  'number',
  'textarea',
  'select',
  'checkbox',
  'url',
  'date',
] as const
export type CrmFormFieldType = (typeof FORM_FIELD_TYPES)[number]

/**
 * Alvos de mapeamento de campo. Diferente do original (que tem `opportunity`
 * porque a ação LEAD lá cria pessoa+oportunidade direto), o Steel já tem uma
 * entidade `CrmLead` própria com fluxo de conversão dedicado — então aqui
 * LEAD mapeia pra `lead`, não pra pessoa+oportunidade.
 */
export const FIELD_TARGETS = ['person', 'company', 'lead'] as const
export type CrmFormFieldTarget = (typeof FIELD_TARGETS)[number]

/** Atributos que um campo pode preencher, por entidade alvo — allowlist
 * derivada dos contratos de create de cada entidade (nunca expõe colunas
 * arbitrárias do banco). */
export const TARGET_ATTRIBUTES = {
  person: ['name', 'email', 'phone', 'city', 'jobTitle', 'linkedin', 'avatar'],
  company: ['name', 'cnpj', 'domain', 'employees', 'linkedin', 'arr'],
  lead: ['name', 'email', 'phone', 'company', 'jobTitle', 'source'],
} as const satisfies Record<CrmFormFieldTarget, readonly string[]>

/** Destinos permitidos por ação. */
export const ACTION_TARGETS = {
  COMPANY: ['company'],
  PERSON: ['person'],
  LEAD: ['lead'],
} as const satisfies Record<CrmFormActionType, readonly CrmFormFieldTarget[]>

const OptionSchema = z.object({
  label: z.string().trim().min(1, 'Rótulo da opção é obrigatório').max(120),
  value: z.string().trim().min(1, 'Valor da opção é obrigatório').max(120),
})

const MappingSchema = z
  .object({
    target: z.enum(FIELD_TARGETS),
    attribute: z.string().trim().min(1),
  })
  .refine(
    (m) =>
      (TARGET_ATTRIBUTES[m.target] as readonly string[]).includes(m.attribute),
    { message: 'Atributo inválido para o destino selecionado' },
  )

export const CrmFormFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[a-z][a-z0-9_]*$/, 'Use apenas letras minúsculas, números e _'),
    label: z.string().trim().min(1, 'Informe o rótulo do campo').max(120),
    type: z.enum(FORM_FIELD_TYPES),
    required: z.boolean().optional().default(false),
    placeholder: z.string().trim().max(200).optional(),
    options: z.array(OptionSchema).max(50).optional(),
    mapping: MappingSchema,
    phaseId: z.string().trim().min(1).max(60).optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === 'select' && (field.options?.length ?? 0) === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Campos de seleção exigem ao menos uma opção',
      })
    }
  })

export type CrmFormFieldDTO = z.infer<typeof CrmFormFieldSchema>

const CrmFormFieldsSchema = z
  .array(CrmFormFieldSchema)
  .max(50, 'No máximo 50 campos')
  .superRefine((fields, ctx) => {
    const seen = new Set<string>()
    fields.forEach((field, index) => {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'key'],
          message: `Chave duplicada: "${field.key}"`,
        })
      }
      seen.add(field.key)
    })
  })

export const CrmFormPhaseSchema = z.object({
  id: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1, 'Título da fase é obrigatório').max(120),
  description: z.string().trim().max(500).optional(),
})

export type CrmFormPhaseDTO = z.infer<typeof CrmFormPhaseSchema>

// Sem campo `order` de propósito — igual a `fields`, a posição no array já é
// a ordem. Não reintroduzir `order` por analogia com
// CrmProposalTemplateSection (aquele é linha de banco de verdade; isto é
// Json solto em CrmForm.phases).
const CrmFormPhasesSchema = z
  .array(CrmFormPhaseSchema)
  .max(10, 'No máximo 10 fases')
  .superRefine((phases, ctx) => {
    const seen = new Set<string>()
    phases.forEach((phase, index) => {
      if (seen.has(phase.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `Id de fase duplicado: "${phase.id}"`,
        })
      }
      seen.add(phase.id)
    })
  })

/** Todo campo com `phaseId` referenciado precisa apontar pra uma fase
 * existente no mesmo payload. Roda a nível de objeto (não dentro de
 * `CrmFormFieldsSchema`, que não enxerga `phases`). */
function validatePhaseReferences(
  fields: CrmFormFieldDTO[],
  phases: CrmFormPhaseDTO[],
  ctx: z.RefinementCtx,
) {
  const phaseIds = new Set(phases.map((p) => p.id))
  fields.forEach((field, index) => {
    if (field.phaseId && !phaseIds.has(field.phaseId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['fields', index, 'phaseId'],
        message: 'Fase inválida para este campo',
      })
    }
  })
}

/** Agrupa `fields` por fase, na ordem de `phases`. Campo sem `phaseId` (ou
 * com `phaseId` órfão, ex. após a fase ter sido apagada) cai na primeira
 * fase — regra centralizada aqui pra builder e renderer público nunca
 * divergirem sobre "campo órfão vai pra onde". */
export function groupFieldsByPhase(
  fields: CrmFormFieldDTO[],
  phases: CrmFormPhaseDTO[],
): Array<{ phase: CrmFormPhaseDTO; fields: CrmFormFieldDTO[] }> {
  if (phases.length === 0) return []
  const defaultId = phases[0].id
  const phaseIds = new Set(phases.map((p) => p.id))
  return phases.map((phase) => ({
    phase,
    fields: fields.filter((f) => {
      const resolved =
        f.phaseId && phaseIds.has(f.phaseId) ? f.phaseId : defaultId
      return resolved === phase.id
    }),
  }))
}

export const CreateCrmFormSchema = z
  .object({
    name: z.string().min(1, 'Nome é obrigatório').max(200),
    description: z.string().max(2000).optional(),
    action: z.enum(FORM_ACTIONS).default('LEAD'),
    fields: CrmFormFieldsSchema.default([]),
    phases: CrmFormPhasesSchema.default([]),
    successMessage: z.string().max(500).optional(),
    redirectUrl: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    validatePhaseReferences(data.fields, data.phases, ctx)
  })

export type CreateCrmFormDTO = z.infer<typeof CreateCrmFormSchema>

export const UpdateCrmFormSchema = z
  .object({
    name: z.string().min(1, 'Nome é obrigatório').max(200).optional(),
    description: z.string().max(2000).optional(),
    action: z.enum(FORM_ACTIONS).optional(),
    fields: CrmFormFieldsSchema.optional(),
    phases: CrmFormPhasesSchema.optional(),
    status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
    successMessage: z.string().max(500).optional(),
    redirectUrl: z.string().max(500).optional(),
    /** Newsletter the consent box subscribes to (ADR 0054); null = none. */
    newsletterId: z.string().min(1).nullable().optional(),
    /** Booking page offered after the submission (crm-ops C5); null = none. */
    bookingPageId: z.string().min(1).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // Só valida a referência cruzada quando os dois vêm juntos no PATCH — se
    // só um vier, a validação final acontece no service (que faz merge com o
    // registro atual antes de persistir).
    if (data.fields && data.phases) {
      validatePhaseReferences(data.fields, data.phases, ctx)
    }
  })

export type UpdateCrmFormDTO = z.infer<typeof UpdateCrmFormSchema>

export const ReorderCrmFormsSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
})

export type ReorderCrmFormsDTO = z.infer<typeof ReorderCrmFormsSchema>

/** `values` chaveado pela `key` do campo — tipos variam por `type`
 * (checkbox → boolean, os demais → string). */
export const SubmitCrmFormSchema = z.object({
  values: z.record(z.string(), z.union([z.string(), z.boolean()])),
  /** Campaign parameters of the page URL (multichannel campaigns). */
  campaign: CrmCampaignRefSchema.optional(),
  /** Visitor ticked "receive the newsletter" (only when the form has one). */
  newsletterConsent: z.boolean().optional(),
})

export type SubmitCrmFormDTO = z.infer<typeof SubmitCrmFormSchema>
