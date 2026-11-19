import z from 'zod'

/**
 * Dynamic contact segments (CRM > Captar e qualificar > Segmentação).
 *
 * A segment is a saved set of rules over people, leads or companies. The
 * rules are combined with E (`ALL`) or OU (`ANY`) at the top level and may
 * hold groups, each with its own E/OU. A segment is never a frozen list:
 * its members are resolved when the segment is read or when it is used as a
 * campaign audience (opt-outs are applied by the consumer at send time).
 * Compiled to Prisma by `src/lib/crm-segment/compile.ts`.
 */

export const CRM_SEGMENT_TARGETS = ['PERSON', 'LEAD', 'COMPANY'] as const
export type CrmSegmentTarget = (typeof CRM_SEGMENT_TARGETS)[number]

export const CRM_SEGMENT_MAX_CONDITIONS = 20
export const CRM_SEGMENT_MAX_GROUPS = 5
export const CRM_SEGMENT_MAX_GROUP_CONDITIONS = 10
export const CRM_SEGMENTS_PER_WORKSPACE = 200
/** Contacts shown by the live preview. */
export const CRM_SEGMENT_SAMPLE_SIZE = 10

export const CRM_SEGMENT_TEXT_FIELDS = [
  'name',
  'email',
  'phone',
  'city',
  'jobTitle',
  'company',
  'source',
  'channel',
  'domain',
  'size',
] as const
export type CrmSegmentTextField = (typeof CRM_SEGMENT_TEXT_FIELDS)[number]

/** Text fields each target offers. */
export const CRM_SEGMENT_TEXT_FIELDS_BY_TARGET: Record<
  CrmSegmentTarget,
  CrmSegmentTextField[]
> = {
  PERSON: ['name', 'email', 'phone', 'city', 'jobTitle'],
  LEAD: [
    'name',
    'email',
    'phone',
    'company',
    'jobTitle',
    'city',
    'source',
    'channel',
  ],
  COMPANY: ['name', 'email', 'phone', 'domain', 'size'],
}

/** E-mail and phone are lists: only an exact match is possible. */
export const CRM_SEGMENT_LIST_FIELDS: CrmSegmentTextField[] = ['email', 'phone']

export const CRM_SEGMENT_NUMBER_FIELDS = ['score', 'employees', 'arr'] as const
export type CrmSegmentNumberField = (typeof CRM_SEGMENT_NUMBER_FIELDS)[number]

export const CRM_SEGMENT_NUMBER_FIELDS_BY_TARGET: Record<
  CrmSegmentTarget,
  CrmSegmentNumberField[]
> = {
  PERSON: [],
  LEAD: ['score'],
  COMPANY: ['employees', 'arr'],
}

export const CRM_SEGMENT_LEAD_STAGES = [
  'RECEIVED',
  'IN_CONTACT',
  'QUALIFIED',
  'OPPORTUNITY',
  'PROPOSAL',
  'CLOSED',
] as const

export const CRM_SEGMENT_CONSENT_VALUES = [
  'emailOptedOut',
  'emailAllowed',
  'hasEmail',
  'hasPhone',
] as const

const IdSchema = z.string().trim().min(1).max(64)

const DaysSchema = z.coerce
  .number()
  .int('Use um número inteiro de dias')
  .min(1, 'Use pelo menos 1 dia')
  .max(3650, 'Use no máximo 3650 dias')

const IdsSchema = (message: string) =>
  z.array(IdSchema).min(1, message).max(50, 'Escolha no máximo 50 itens')

export const CrmSegmentConditionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    field: z.enum(CRM_SEGMENT_TEXT_FIELDS),
    op: z.enum(['equals', 'contains', 'isSet', 'isNotSet']),
    value: z
      .string()
      .trim()
      .max(200, 'Use no máximo 200 caracteres')
      .optional(),
  }),
  z.object({
    type: z.literal('number'),
    field: z.enum(CRM_SEGMENT_NUMBER_FIELDS),
    op: z.enum(['gte', 'lte', 'eq']),
    value: z.coerce
      .number()
      .refine((n) => Number.isFinite(n), { message: 'Informe um número' }),
  }),
  z.object({
    type: z.literal('leadStage'),
    stages: z
      .array(z.enum(CRM_SEGMENT_LEAD_STAGES))
      .min(1, 'Escolha ao menos uma etapa')
      .max(CRM_SEGMENT_LEAD_STAGES.length),
  }),
  z.object({
    type: z.literal('owner'),
    /** `in` = one of the users; `none` = nobody is responsible. */
    op: z.enum(['in', 'none']),
    userIds: z.array(IdSchema).max(50).default([]),
  }),
  z.object({
    type: z.literal('company'),
    companyIds: IdsSchema('Escolha ao menos uma empresa'),
  }),
  z.object({
    type: z.literal('createdAt'),
    op: z.enum(['withinDays', 'olderThanDays']),
    days: DaysSchema,
  }),
  z.object({
    type: z.literal('customField'),
    definitionId: IdSchema,
    op: z.enum(['equals', 'contains', 'isSet', 'isNotSet']),
    value: z
      .union([z.string().trim().max(200), z.number(), z.boolean()])
      .optional(),
  }),
  z.object({
    type: z.literal('activity'),
    /** `withinDays` = some activity registered; `noneInDays` = none. */
    op: z.enum(['withinDays', 'noneInDays']),
    days: DaysSchema,
  }),
  z.object({
    type: z.literal('emailEngagement'),
    event: z.enum(['received', 'opened', 'clicked']),
    op: z.enum(['any', 'none']),
    days: DaysSchema,
  }),
  z.object({
    type: z.literal('campaign'),
    op: z.enum(['in', 'notIn']),
    campaignIds: IdsSchema('Escolha ao menos uma campanha'),
  }),
  z.object({
    type: z.literal('mailingList'),
    op: z.enum(['in', 'notIn']),
    listIds: IdsSchema('Escolha ao menos uma lista'),
  }),
  z.object({
    type: z.literal('deals'),
    kind: z.enum(['won', 'open']),
    has: z.boolean(),
    /** Only for `won`: closed within the last N days. */
    withinDays: DaysSchema.optional(),
  }),
  z.object({
    type: z.literal('consent'),
    value: z.enum(CRM_SEGMENT_CONSENT_VALUES),
  }),
])

export type CrmSegmentCondition = z.infer<typeof CrmSegmentConditionSchema>
export type CrmSegmentConditionType = CrmSegmentCondition['type']

export const CrmSegmentMatchSchema = z.enum(['ALL', 'ANY'])
export type CrmSegmentMatch = z.infer<typeof CrmSegmentMatchSchema>

export const CrmSegmentGroupSchema = z.object({
  match: CrmSegmentMatchSchema.default('ALL'),
  conditions: z
    .array(CrmSegmentConditionSchema)
    .min(1, 'Um grupo precisa de ao menos uma regra')
    .max(CRM_SEGMENT_MAX_GROUP_CONDITIONS),
})
export type CrmSegmentGroup = z.infer<typeof CrmSegmentGroupSchema>

export const CrmSegmentDefinitionSchema = z.object({
  match: CrmSegmentMatchSchema.default('ALL'),
  conditions: z
    .array(CrmSegmentConditionSchema)
    .max(CRM_SEGMENT_MAX_CONDITIONS)
    .default([]),
  groups: z
    .array(CrmSegmentGroupSchema)
    .max(CRM_SEGMENT_MAX_GROUPS)
    .default([]),
})
export type CrmSegmentDefinition = z.infer<typeof CrmSegmentDefinitionSchema>

export const EMPTY_SEGMENT_DEFINITION: CrmSegmentDefinition = {
  match: 'ALL',
  conditions: [],
  groups: [],
}

/** No rules at all = every record of the target. */
export function isEmptySegmentDefinition(def: CrmSegmentDefinition): boolean {
  return def.conditions.length === 0 && def.groups.length === 0
}

export function allSegmentConditions(
  def: CrmSegmentDefinition,
): CrmSegmentCondition[] {
  return [...def.conditions, ...def.groups.flatMap((g) => g.conditions)]
}

/** Targets each rule type applies to. */
export const CRM_SEGMENT_CONDITION_TARGETS: Record<
  CrmSegmentConditionType,
  CrmSegmentTarget[]
> = {
  text: ['PERSON', 'LEAD', 'COMPANY'],
  number: ['LEAD', 'COMPANY'],
  leadStage: ['LEAD'],
  owner: ['PERSON', 'LEAD', 'COMPANY'],
  company: ['PERSON'],
  createdAt: ['PERSON', 'LEAD', 'COMPANY'],
  customField: ['PERSON', 'COMPANY'],
  activity: ['PERSON', 'COMPANY'],
  emailEngagement: ['PERSON', 'LEAD'],
  campaign: ['PERSON', 'LEAD'],
  mailingList: ['PERSON', 'LEAD'],
  deals: ['PERSON', 'COMPANY'],
  consent: ['PERSON', 'LEAD', 'COMPANY'],
}

/**
 * Checks what the discriminated union cannot: that each rule fits the
 * target and carries the value its operator needs. Returns the first
 * problem as a user-facing message, or `null` when the definition is valid.
 */
export function validateSegmentDefinition(
  target: CrmSegmentTarget,
  def: CrmSegmentDefinition,
): string | null {
  for (const condition of allSegmentConditions(def)) {
    if (!CRM_SEGMENT_CONDITION_TARGETS[condition.type].includes(target)) {
      return 'Há uma regra que não vale para este tipo de contato'
    }
    switch (condition.type) {
      case 'text': {
        if (
          !CRM_SEGMENT_TEXT_FIELDS_BY_TARGET[target].includes(condition.field)
        ) {
          return 'Há um campo que não existe para este tipo de contato'
        }
        const needsValue =
          condition.op === 'equals' || condition.op === 'contains'
        if (needsValue && !condition.value?.trim()) {
          return 'Informe o valor de todas as regras de texto'
        }
        if (
          condition.op === 'contains' &&
          CRM_SEGMENT_LIST_FIELDS.includes(condition.field)
        ) {
          return 'E-mail e telefone aceitam apenas "é igual a"'
        }
        break
      }
      case 'number':
        if (
          !CRM_SEGMENT_NUMBER_FIELDS_BY_TARGET[target].includes(condition.field)
        ) {
          return 'Há um campo numérico que não existe para este tipo de contato'
        }
        break
      case 'owner':
        if (condition.op === 'in' && condition.userIds.length === 0) {
          return 'Escolha ao menos um responsável'
        }
        break
      case 'customField': {
        const needsValue =
          condition.op === 'equals' || condition.op === 'contains'
        if (
          needsValue &&
          (condition.value === undefined || condition.value === '')
        ) {
          return 'Informe o valor de todas as regras de campo personalizado'
        }
        break
      }
      default:
        break
    }
  }
  return null
}

const SegmentNameSchema = z
  .string()
  .trim()
  .min(1, 'Informe o nome do segmento')
  .max(80, 'Use no máximo 80 caracteres')

const SegmentDescriptionSchema = z
  .string()
  .trim()
  .max(300, 'Use no máximo 300 caracteres')

export const CreateCrmSegmentSchema = z
  .object({
    name: SegmentNameSchema,
    description: SegmentDescriptionSchema.nullish(),
    target: z.enum(CRM_SEGMENT_TARGETS),
    definition: CrmSegmentDefinitionSchema,
  })
  .superRefine((value, ctx) => {
    const problem = validateSegmentDefinition(value.target, value.definition)
    if (problem)
      ctx.addIssue({ code: 'custom', message: problem, path: ['definition'] })
  })
export type CreateCrmSegmentDTO = z.infer<typeof CreateCrmSegmentSchema>

export const UpdateCrmSegmentSchema = z
  .object({
    name: SegmentNameSchema.optional(),
    description: SegmentDescriptionSchema.nullish(),
    target: z.enum(CRM_SEGMENT_TARGETS).optional(),
    definition: CrmSegmentDefinitionSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo para atualizar',
  })
export type UpdateCrmSegmentDTO = z.infer<typeof UpdateCrmSegmentSchema>

/** Live preview of an unsaved (or edited) segment. */
export const PreviewCrmSegmentSchema = z
  .object({
    target: z.enum(CRM_SEGMENT_TARGETS),
    definition: CrmSegmentDefinitionSchema,
  })
  .superRefine((value, ctx) => {
    const problem = validateSegmentDefinition(value.target, value.definition)
    if (problem)
      ctx.addIssue({ code: 'custom', message: problem, path: ['definition'] })
  })
export type PreviewCrmSegmentDTO = z.infer<typeof PreviewCrmSegmentSchema>

export const ListCrmSegmentContactsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export interface CrmSegmentDTO {
  id: string
  name: string
  description: string | null
  target: CrmSegmentTarget
  definition: CrmSegmentDefinition
  /** `false` when the stored definition no longer parses. */
  valid: boolean
  createdAt: string
  updatedAt: string
}

export interface CrmSegmentContactDTO {
  id: string
  name: string
  email: string | null
  phone: string | null
}

export interface CrmSegmentPreviewDTO {
  total: number
  sample: CrmSegmentContactDTO[]
}

export interface CrmSegmentContactsPageDTO {
  total: number
  page: number
  pageSize: number
  items: CrmSegmentContactDTO[]
}

/** Lookups the rule builder needs (campaigns, lists, custom fields, users). */
export interface CrmSegmentOptionsDTO {
  campaigns: { id: string; name: string }[]
  mailingLists: { id: string; name: string }[]
  customFields: {
    id: string
    label: string
    entity: 'PERSON' | 'COMPANY'
    type: string
    options: string[]
  }[]
}
