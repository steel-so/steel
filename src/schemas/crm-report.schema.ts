import z from 'zod'

/**
 * Contrato do "mega relatório" — múltiplas fontes do CRM combinadas por
 * JOIN (mesclagem por chave) ou UNION (empilhamento com colunas mapeadas),
 * com agregação (count/sum/avg/min/max), ordenação e projeção de colunas.
 */

export const CRM_REPORT_SOURCES = [
  'company',
  'person',
  'opportunity',
  'lead',
  'task',
  'note',
  'product',
  'whatsapp_conversation',
  'whatsapp_ai_campaign',
  'whatsapp_broadcast',
] as const
export type CrmReportSource = (typeof CRM_REPORT_SOURCES)[number]

export const CRM_REPORT_AGGREGATION_FNS = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
] as const
export type CrmReportAggregationFn = (typeof CRM_REPORT_AGGREGATION_FNS)[number]

export const CRM_REPORT_FILTER_OPERATORS = [
  'contains',
  'equals',
  'not_equals',
  'is_empty',
  'is_not_empty',
] as const
export type CrmReportFilterOperator =
  (typeof CRM_REPORT_FILTER_OPERATORS)[number]

const NameSchema = z
  .string()
  .trim()
  .min(1, 'Informe o nome do relatório')
  .max(120, 'Nome muito longo')

const ColumnsSchema = z
  .array(z.string().trim().min(1).max(100))
  .min(1, 'Selecione ao menos uma coluna')
  .max(50)

const FilterSchema = z.object({
  field: z.string().trim().min(1).max(100),
  operator: z.enum(CRM_REPORT_FILTER_OPERATORS),
  value: z.string().trim().max(500).optional().default(''),
})

const SortSchema = z.object({
  field: z.string().trim().min(1).max(100),
  direction: z.enum(['asc', 'desc']),
})

/** Alias de dataset: minúsculas, dígitos e "_" (usado como prefixo de coluna). */
const AliasSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9_]+$/, 'Alias inválido')

/** Uma fonte dentro da query, com filtros próprios. */
const DatasetSchema = z.object({
  alias: AliasSchema,
  source: z.enum(CRM_REPORT_SOURCES),
  filters: z.array(FilterSchema).max(20).optional().default([]),
})

/** Mesclagem entre dois datasets por chave (FK → id). */
const JoinSchema = z.object({
  leftAlias: AliasSchema,
  rightAlias: AliasSchema,
  leftField: z.string().trim().min(1).max(100),
  rightField: z.string().trim().min(1).max(100),
  type: z.enum(['inner', 'left']),
})

/** Uma agregação sobre o grupo (count ignora `field`). */
const AggregationSchema = z.object({
  fn: z.enum(CRM_REPORT_AGGREGATION_FNS),
  field: z.string().trim().min(1).max(100).optional(),
  alias: z.string().trim().min(1).max(60),
})

/** Agrupamento por 1+ colunas + agregações. */
const GroupSchema = z.object({
  by: z.array(z.string().trim().min(1).max(100)).min(1).max(5),
  aggregations: z.array(AggregationSchema).min(1).max(10),
})

/** Coluna de UNION: chave de saída mapeada ao campo de cada dataset. */
const UnionColumnSchema = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(60),
  fields: z.record(AliasSchema, z.string().trim().min(1).max(100)),
})

/** Modo JOIN: enriquece o dataset base com colunas dos relacionados. */
const JoinQuerySchema = z.object({
  mode: z.literal('join'),
  datasets: z.array(DatasetSchema).min(1).max(5),
  joins: z.array(JoinSchema).max(4).optional().default([]),
  /** Colunas namespaced: "alias.field". */
  columns: ColumnsSchema,
  group: GroupSchema.optional(),
  sort: SortSchema.optional(),
})

/** Modo UNION: empilha registros de fontes distintas com colunas mapeadas. */
const UnionQuerySchema = z.object({
  mode: z.literal('union'),
  datasets: z.array(DatasetSchema).min(2).max(5),
  columns: z.array(UnionColumnSchema).min(1).max(50),
  includeSource: z.boolean().optional().default(false),
  group: GroupSchema.optional(),
  sort: SortSchema.optional(),
})

export const CrmReportQuerySchema = z.discriminatedUnion('mode', [
  JoinQuerySchema,
  UnionQuerySchema,
])

export const CreateCrmReportSchema = z.object({
  name: NameSchema,
  source: z.enum(CRM_REPORT_SOURCES),
  columns: ColumnsSchema,
  filters: z.array(FilterSchema).max(20).optional().default([]),
  groupBy: z.string().trim().max(100).optional(),
  sort: SortSchema.optional(),
  query: CrmReportQuerySchema.optional(),
})

export type CreateCrmReportDTO = z.infer<typeof CreateCrmReportSchema>

export const UpdateCrmReportSchema = z
  .object({
    name: NameSchema,
    columns: ColumnsSchema,
    filters: z.array(FilterSchema).max(20),
    groupBy: z.string().trim().max(100).nullable(),
    sort: SortSchema.nullable(),
    query: CrmReportQuerySchema.nullable(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar',
  })

export type UpdateCrmReportDTO = z.infer<typeof UpdateCrmReportSchema>

export const ReorderCrmReportsSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
})

export type ReorderCrmReportsDTO = z.infer<typeof ReorderCrmReportsSchema>

/** Coluna de saída processada: chave estável + rótulo amigável. */
const ReportColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
})

/** Resultado processado (linhas indexadas por `column.key`). */
export const CrmReportDataSchema = z.object({
  columns: z.array(ReportColumnSchema),
  rows: z.array(z.record(z.string(), z.unknown())),
  grouped: z.boolean(),
  total: z.number(),
})

export type CrmReportData = z.infer<typeof CrmReportDataSchema>
export type CrmReportColumn = z.infer<typeof ReportColumnSchema>
export type CrmReportFilter = z.infer<typeof FilterSchema>
export type CrmReportSort = z.infer<typeof SortSchema>
export type CrmReportQuery = z.infer<typeof CrmReportQuerySchema>
export type CrmReportDataset = z.infer<typeof DatasetSchema>
export type CrmReportJoin = z.infer<typeof JoinSchema>
export type CrmReportAggregation = z.infer<typeof AggregationSchema>
export type CrmReportGroup = z.infer<typeof GroupSchema>
export type CrmReportUnionColumn = z.infer<typeof UnionColumnSchema>
export type CrmJoinQuery = z.infer<typeof JoinQuerySchema>
export type CrmUnionQuery = z.infer<typeof UnionQuerySchema>
