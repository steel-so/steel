import z from 'zod'

/**
 * Busca em linguagem natural nas oportunidades (C10). A pergunta livre vira
 * um filtro estruturado e validado — o modelo nunca escreve SQL nem recebe
 * dados do CRM: só devolve este JSON, que o repositório traduz em `where`.
 */

export const CRM_NL_SEARCH_MAX_QUERY = 300

export const CrmNlSearchSchema = z.object({
  query: z
    .string()
    .trim()
    .min(2, 'Escreva a pergunta')
    .max(CRM_NL_SEARCH_MAX_QUERY, 'Pergunta longa demais'),
})

export type CrmNlSearchDTO = z.infer<typeof CrmNlSearchSchema>

/** Situação do negócio: `OPEN` etapas em andamento, `WON` ganhos, `LOST` perdidos. */
export const CrmNlSearchStatusEnum = z.enum(['OPEN', 'WON', 'LOST', 'ANY'])

const days = z.number().int().min(0).max(3650)
const money = z.number().min(0).max(1_000_000_000_000)

/**
 * Filtro estruturado. Todo campo é opcional e os campos se combinam com E.
 * `null` e ausente significam "sem restrição" (o modelo costuma devolver
 * `null` para o que não foi dito).
 */
export const CrmNlSearchFilterSchema = z.object({
  status: CrmNlSearchStatusEnum.nullish().transform((v) => v ?? 'OPEN'),
  amountMin: money.nullish().transform((v) => v ?? undefined),
  amountMax: money.nullish().transform((v) => v ?? undefined),
  /** Sem atualização há pelo menos N dias ("parados há 15 dias"). */
  stalledForDays: days.nullish().transform((v) => v ?? undefined),
  /** Criados nos últimos N dias. */
  createdWithinDays: days.nullish().transform((v) => v ?? undefined),
  /** Fechamento previsto nos próximos N dias (a partir de hoje). */
  closingWithinDays: days.nullish().transform((v) => v ?? undefined),
  /** Fechamento previsto já vencido (data no passado, ainda em aberto). */
  closeDateOverdue: z
    .boolean()
    .nullish()
    .transform((v) => v ?? undefined),
  /** Sem data de fechamento prevista. */
  noCloseDate: z
    .boolean()
    .nullish()
    .transform((v) => v ?? undefined),
  probabilityMin: z
    .number()
    .int()
    .min(0)
    .max(100)
    .nullish()
    .transform((v) => v ?? undefined),
  probabilityMax: z
    .number()
    .int()
    .min(0)
    .max(100)
    .nullish()
    .transform((v) => v ?? undefined),
  /** "Meus negócios": o responsável é quem perguntou. */
  ownedByMe: z
    .boolean()
    .nullish()
    .transform((v) => v ?? undefined),
  /** Sem responsável definido. */
  unassigned: z
    .boolean()
    .nullish()
    .transform((v) => v ?? undefined),
  /** Trecho do nome da etapa ("proposta", "negociação"). */
  stageContains: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .nullish()
    .transform((v) => v ?? undefined),
  /** Trecho do nome do negócio ou da origem. */
  textContains: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .nullish()
    .transform((v) => v ?? undefined),
  sort: z
    .enum(['AMOUNT_DESC', 'AMOUNT_ASC', 'STALLED_DESC', 'CLOSE_DATE_ASC'])
    .nullish()
    .transform((v) => v ?? undefined),
})

export type CrmNlSearchFilter = z.infer<typeof CrmNlSearchFilterSchema>

/** Resposta de JSON schema pedida ao provedor (modo estrito: tudo obrigatório e anulável). */
const NULLABLE = (type: string | string[], extra: object = {}) => ({
  type: Array.isArray(type) ? [...type, 'null'] : [type, 'null'],
  ...extra,
})

export const CRM_NL_SEARCH_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'status',
    'amountMin',
    'amountMax',
    'stalledForDays',
    'createdWithinDays',
    'closingWithinDays',
    'closeDateOverdue',
    'noCloseDate',
    'probabilityMin',
    'probabilityMax',
    'ownedByMe',
    'unassigned',
    'stageContains',
    'textContains',
    'sort',
  ],
  properties: {
    status: { type: 'string', enum: ['OPEN', 'WON', 'LOST', 'ANY'] },
    amountMin: NULLABLE('number'),
    amountMax: NULLABLE('number'),
    stalledForDays: NULLABLE('integer'),
    createdWithinDays: NULLABLE('integer'),
    closingWithinDays: NULLABLE('integer'),
    closeDateOverdue: NULLABLE('boolean'),
    noCloseDate: NULLABLE('boolean'),
    probabilityMin: NULLABLE('integer'),
    probabilityMax: NULLABLE('integer'),
    ownedByMe: NULLABLE('boolean'),
    unassigned: NULLABLE('boolean'),
    stageContains: NULLABLE('string'),
    textContains: NULLABLE('string'),
    sort: NULLABLE('string', {
      enum: [
        'AMOUNT_DESC',
        'AMOUNT_ASC',
        'STALLED_DESC',
        'CLOSE_DATE_ASC',
        null,
      ],
    }),
  },
}

// ─── Leads, people and companies (ai-crm-followups) ─────────────────────────
// Same design as the opportunity search: the model only turns the question
// into one of these validated filters; it never sees CRM data and never
// writes SQL. Every filter field is optional and combines with E.

/** Registros que a busca em linguagem natural cobre além das oportunidades. */
export const CrmNlSearchEntityEnum = z.enum(['leads', 'people', 'companies'])
export type CrmNlSearchEntity = z.infer<typeof CrmNlSearchEntityEnum>

const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined)

const textTerm = (max: number) => z.string().trim().min(1).max(max)

const LEAD_STAGES = [
  'RECEIVED',
  'IN_CONTACT',
  'QUALIFIED',
  'OPPORTUNITY',
  'PROPOSAL',
  'CLOSED',
] as const

export const CrmNlLeadFilterSchema = z.object({
  /** `OPEN` = qualquer etapa menos Fechado; `WON`/`LOST` = fechados com esse resultado. */
  status: CrmNlSearchStatusEnum.nullish().transform((v) => v ?? 'OPEN'),
  /** Etapa específica do painel de leads. */
  stage: optional(z.enum(LEAD_STAGES)),
  scoreMin: optional(z.number().int().min(0).max(100_000)),
  scoreMax: optional(z.number().int().min(0).max(100_000)),
  createdWithinDays: optional(days),
  /** Sem nenhuma atualização há pelo menos N dias. */
  stalledForDays: optional(days),
  ownedByMe: optional(z.boolean()),
  unassigned: optional(z.boolean()),
  hasEmail: optional(z.boolean()),
  hasPhone: optional(z.boolean()),
  channelContains: optional(textTerm(80)),
  sourceContains: optional(textTerm(80)),
  cityContains: optional(textTerm(80)),
  /** Trecho do nome, da empresa ou do cargo. */
  textContains: optional(textTerm(120)),
  sort: optional(
    z.enum(['SCORE_DESC', 'CREATED_DESC', 'STALLED_DESC', 'NAME_ASC']),
  ),
})
export type CrmNlLeadFilter = z.infer<typeof CrmNlLeadFilterSchema>

export const CrmNlPersonFilterSchema = z.object({
  createdWithinDays: optional(days),
  stalledForDays: optional(days),
  hasEmail: optional(z.boolean()),
  hasPhone: optional(z.boolean()),
  /** `true` = com empresa vinculada, `false` = sem empresa. */
  hasCompany: optional(z.boolean()),
  companyContains: optional(textTerm(120)),
  jobTitleContains: optional(textTerm(80)),
  cityContains: optional(textTerm(80)),
  textContains: optional(textTerm(120)),
  sort: optional(z.enum(['NAME_ASC', 'CREATED_DESC', 'STALLED_DESC'])),
})
export type CrmNlPersonFilter = z.infer<typeof CrmNlPersonFilterSchema>

export const CrmNlCompanyFilterSchema = z.object({
  icp: optional(z.boolean()),
  employeesMin: optional(z.number().int().min(0).max(10_000_000)),
  employeesMax: optional(z.number().int().min(0).max(10_000_000)),
  arrMin: optional(money),
  arrMax: optional(money),
  hasCnpj: optional(z.boolean()),
  /** Com dados da Receita (enriquecimento pelo CNPJ). */
  enriched: optional(z.boolean()),
  /** Ramo de atividade (CNAE) da Receita, ex.: "alimentos". */
  activityContains: optional(textTerm(80)),
  domainContains: optional(textTerm(120)),
  createdWithinDays: optional(days),
  stalledForDays: optional(days),
  ownedByMe: optional(z.boolean()),
  unassigned: optional(z.boolean()),
  textContains: optional(textTerm(120)),
  sort: optional(
    z.enum(['ARR_DESC', 'EMPLOYEES_DESC', 'CREATED_DESC', 'NAME_ASC']),
  ),
})
export type CrmNlCompanyFilter = z.infer<typeof CrmNlCompanyFilterSchema>

/** Strict provider schema: every field required and nullable. */
function strictFilterSchema(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  }
}

const nullableEnum = (values: readonly string[]) =>
  NULLABLE('string', { enum: [...values, null] })

export const CRM_NL_LEAD_JSON_SCHEMA = strictFilterSchema({
  status: { type: 'string', enum: ['OPEN', 'WON', 'LOST', 'ANY'] },
  stage: nullableEnum(LEAD_STAGES),
  scoreMin: NULLABLE('integer'),
  scoreMax: NULLABLE('integer'),
  createdWithinDays: NULLABLE('integer'),
  stalledForDays: NULLABLE('integer'),
  ownedByMe: NULLABLE('boolean'),
  unassigned: NULLABLE('boolean'),
  hasEmail: NULLABLE('boolean'),
  hasPhone: NULLABLE('boolean'),
  channelContains: NULLABLE('string'),
  sourceContains: NULLABLE('string'),
  cityContains: NULLABLE('string'),
  textContains: NULLABLE('string'),
  sort: nullableEnum([
    'SCORE_DESC',
    'CREATED_DESC',
    'STALLED_DESC',
    'NAME_ASC',
  ]),
})

export const CRM_NL_PERSON_JSON_SCHEMA = strictFilterSchema({
  createdWithinDays: NULLABLE('integer'),
  stalledForDays: NULLABLE('integer'),
  hasEmail: NULLABLE('boolean'),
  hasPhone: NULLABLE('boolean'),
  hasCompany: NULLABLE('boolean'),
  companyContains: NULLABLE('string'),
  jobTitleContains: NULLABLE('string'),
  cityContains: NULLABLE('string'),
  textContains: NULLABLE('string'),
  sort: nullableEnum(['NAME_ASC', 'CREATED_DESC', 'STALLED_DESC']),
})

export const CRM_NL_COMPANY_JSON_SCHEMA = strictFilterSchema({
  icp: NULLABLE('boolean'),
  employeesMin: NULLABLE('integer'),
  employeesMax: NULLABLE('integer'),
  arrMin: NULLABLE('number'),
  arrMax: NULLABLE('number'),
  hasCnpj: NULLABLE('boolean'),
  enriched: NULLABLE('boolean'),
  activityContains: NULLABLE('string'),
  domainContains: NULLABLE('string'),
  createdWithinDays: NULLABLE('integer'),
  stalledForDays: NULLABLE('integer'),
  ownedByMe: NULLABLE('boolean'),
  unassigned: NULLABLE('boolean'),
  textContains: NULLABLE('string'),
  sort: nullableEnum([
    'ARR_DESC',
    'EMPLOYEES_DESC',
    'CREATED_DESC',
    'NAME_ASC',
  ]),
})
