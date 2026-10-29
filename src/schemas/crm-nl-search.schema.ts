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
