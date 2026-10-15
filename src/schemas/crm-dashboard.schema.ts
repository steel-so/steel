import z from 'zod'
import { SalesConfigSchema } from '@/src/schemas/crm-sales-metrics.schema'
import { CRM_SOCIAL_PLATFORMS } from '@/src/schemas/crm-social.schema'

export const CreateCrmDashboardSchema = z.object({
  title: z.string().min(1, 'Título é obrigatório').max(200),
})

export type CreateCrmDashboardDTO = z.infer<typeof CreateCrmDashboardSchema>

/** A dashboard has 1 to 3 screens (pages); the TV can rotate between them. */
export const MAX_DASHBOARD_PAGES = 3
/** Blocks per screen that still read well on a TV across the room. */
export const TV_MAX_BLOCKS_PER_PAGE = 8

export const CrmDashboardSettingsSchema = z.object({
  /** Screen titles; the count is the number of screens. */
  pages: z
    .array(z.string().trim().min(1).max(60))
    .min(1)
    .max(MAX_DASHBOARD_PAGES)
    .default(['Tela 1']),
  /** TV rotation between screens, in seconds (0 = no rotation). */
  rotateSeconds: z
    .number()
    .int()
    .refine((value) => value === 0 || (value >= 10 && value <= 600), {
      message: 'Use 0 (sem rotação) ou de 10 a 600 segundos',
    })
    .default(0),
})

export type CrmDashboardSettings = z.infer<typeof CrmDashboardSettingsSchema>

/** Settings stored before this field existed (`{}`) or broken: defaults. */
export function parseDashboardSettings(value: unknown): CrmDashboardSettings {
  const parsed = CrmDashboardSettingsSchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : CrmDashboardSettingsSchema.parse({})
}

export const UpdateCrmDashboardSchema = z.object({
  title: z.string().min(1, 'Título é obrigatório').max(200).optional(),
  settings: CrmDashboardSettingsSchema.optional(),
})

export type UpdateCrmDashboardDTO = z.infer<typeof UpdateCrmDashboardSchema>

export const ReorderCrmDashboardsSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
})

export type ReorderCrmDashboardsDTO = z.infer<typeof ReorderCrmDashboardsSchema>

/* ----------------------------- config por tipo widget ---------------------------- */

export const WIDGET_TYPES = [
  'CHART',
  'VIEW',
  'IFRAME',
  'RICH_TEXT',
  'SALES',
] as const
export type WidgetType = (typeof WIDGET_TYPES)[number]

/** Subtipos de chart (botões do topo do painel). */
export const CHART_TYPES = [
  'vertical',
  'horizontal',
  'line',
  'pie',
  'aggregate',
] as const
export type ChartType = (typeof CHART_TYPES)[number]

/**
 * Fontes de dados disponíveis para o widget "view" (sempre layout tabela) —
 * as entidades CRM do Steel que já têm endpoint de listagem por workspace.
 * Adaptação: o original também inclui `form-submissions`/`page-views`
 * (eventos, não a entidade), que o Steel não expõe como recurso de lista
 * dedicado — fora do escopo desta fase.
 */
export const VIEW_SOURCES = [
  'companies',
  'people',
  'opportunities',
  'leads',
  'tasks',
  'notes',
  'forms',
  'landing-pages',
  'whatsapp-conversations',
  'whatsapp-broadcasts',
  // ServiceDesk — linhas achatadas servidas por
  // `servicedesk/dashboards/sources/<fonte>` (campos derivados de SLA, MTTR…).
  'sd-tickets',
  'sd-ticket-costs',
  'sd-ticket-events',
  'sd-kb-articles',
] as const
export type ViewSource = (typeof VIEW_SOURCES)[number]

/** Fontes do chart: as do view + "socials" (séries das redes conectadas). */
export const CHART_SOURCES = [...VIEW_SOURCES, 'socials'] as const
export type ChartSource = (typeof CHART_SOURCES)[number]

/**
 * Métricas comparáveis entre redes/contas quando `source === "socials"`.
 * Sem OAuth real ainda (Fase 13 do plano), o backend de métricas sociais no
 * Steel não coleta esses dados — o widget fica funcional na UI, mas a série
 * vem vazia até essa integração existir.
 */
export const SOCIAL_METRICS = [
  'views',
  'followers',
  'impressions',
  'clicks',
  'conversions',
  'cost',
] as const
export type SocialMetric = (typeof SOCIAL_METRICS)[number]

export const FILTER_OPERATORS = [
  'contains',
  'equals',
  'not_equals',
  'is_empty',
  'is_not_empty',
] as const

const ViewFilterSchema = z.object({
  field: z.string().trim().min(1).max(100),
  operator: z.enum(FILTER_OPERATORS),
  value: z.string().trim().max(500).optional().default(''),
})

const ViewSortSchema = z.object({
  field: z.string().trim().min(1).max(100),
  direction: z.enum(['asc', 'desc']),
})

/** Modo de ordenação de um eixo (sem ordenação / crescente / decrescente). */
export const SORT_MODES = ['none', 'asc', 'desc'] as const
export type SortMode = (typeof SORT_MODES)[number]
const SortModeSchema = z.enum(SORT_MODES)

/**
 * Janela de comparação do widget "aggregate": total do período atual (N dias)
 * + variação % vs os N dias imediatamente anteriores. Só se aplica a
 * `chartType === "aggregate"`.
 */
export const COMPARE_RANGES = ['7d', '30d'] as const
export type CompareRange = (typeof COMPARE_RANGES)[number]
const CompareRangeSchema = z.enum(COMPARE_RANGES)

/**
 * Como o valor de cada categoria é calculado a partir das linhas. `auto`
 * (legado) soma o campo de valor quando ele é numérico, senão conta.
 * `avg` ignora linhas sem número (ex.: MTTR só dos resolvidos).
 */
export const AGGREGATIONS = [
  'auto',
  'count',
  'sum',
  'avg',
  'min',
  'max',
] as const
export type Aggregation = (typeof AGGREGATIONS)[number]

/** Agrupamento do eixo X quando o campo é uma data. */
export const DATE_BUCKETS = ['day', 'week', 'month'] as const
export type DateBucket = (typeof DATE_BUCKETS)[number]

/**
 * Janela de tempo aplicada às linhas antes de agregar (no fuso do
 * navegador): hoje, últimos N dias, mês ou ano corrente. O campo de data é
 * `periodField` (padrão `createdAt`).
 */
export const PERIODS = ['today', '7d', '30d', '90d', 'month', 'year'] as const
export type Period = (typeof PERIODS)[number]

/** Campos opcionais comuns a chart e view (ausentes = comportamento legado). */
const dataWindowShape = {
  /** Título exibido no cabeçalho do widget (e em destaque no modo TV). */
  title: z.string().trim().max(120).optional(),
  period: z.enum(PERIODS).optional(),
  periodField: z.string().trim().max(100).optional(),
  /** Top N (categorias no chart, linhas na tabela). */
  limit: z.number().int().min(1).max(500).optional(),
}

/**
 * Customização completa do chart. Os campos relevantes variam por
 * `chartType`; campos não usados pelo tipo são ignorados no render.
 * Agregação do valor: soma quando o campo de valor é numérico, senão
 * contagem.
 */
export const ChartConfigSchema = z.object({
  chartType: z.enum(CHART_TYPES),

  // Dados
  source: z.enum(CHART_SOURCES).default('companies'),
  filters: z.array(ViewFilterSchema).max(20).default([]),
  /** Redes a incluir quando source = "socials" (multi-select). */
  platforms: z.array(z.enum(CRM_SOCIAL_PLATFORMS)).max(6).default([]),
  /** Só usado quando `chartType === "aggregate"`. */
  compareRange: CompareRangeSchema.optional(),

  // Eixos / dados
  xField: z.string().trim().max(100).optional(),
  yField: z.string().trim().max(100).optional(),
  groupBy: z.string().trim().max(100).optional(),
  xSort: SortModeSchema.default('none'),
  ySort: SortModeSchema.default('none'),
  omitZero: z.boolean().default(false),
  cumulative: z.boolean().default(false),
  yMin: z.number().optional(),
  yMax: z.number().optional(),
  hideEmpty: z.boolean().default(false),

  // Estilo
  xAxisName: z.string().trim().max(100).default(''),
  yAxisName: z.string().trim().max(100).default(''),
  stacked: z.boolean().default(false),
  dataLabels: z.boolean().default(false),
  legend: z.boolean().default(true),
  prefix: z.string().trim().max(20).default(''),
  suffix: z.string().trim().max(20).default(''),

  // Extensões (opcionais — configs antigas continuam iguais)
  ...dataWindowShape,
  aggregation: z.enum(AGGREGATIONS).optional(),
  dateBucket: z.enum(DATE_BUCKETS).optional(),
  /** Casas decimais do número exibido (padrão: 0 na contagem, até 1 na média). */
  decimals: z.number().int().min(0).max(4).optional(),
  /** Cor de destaque do número do "aggregate" (ex.: vermelho p/ violados). */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida')
    .optional(),
})

export const ViewConfigSchema = z.object({
  source: z.enum(VIEW_SOURCES),
  fields: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  filters: z.array(ViewFilterSchema).max(20).default([]),
  sort: z.array(ViewSortSchema).max(10).default([]),
  ...dataWindowShape,
})

export const IframeConfigSchema = z.object({
  url: z.url('Informe uma URL válida').max(2000),
})

export const RichTextConfigSchema = z.object({
  html: z.string().max(50_000, 'Conteúdo muito longo').default(''),
})

/** Schema de config correspondente ao tipo do widget. */
export function widgetConfigSchema(type: WidgetType) {
  switch (type) {
    case 'CHART':
      return ChartConfigSchema
    case 'VIEW':
      return ViewConfigSchema
    case 'IFRAME':
      return IframeConfigSchema
    case 'RICH_TEXT':
      return RichTextConfigSchema
    case 'SALES':
      return SalesConfigSchema
  }
}

export type ChartConfig = z.infer<typeof ChartConfigSchema>
export type ViewConfig = z.infer<typeof ViewConfigSchema>
export type IframeConfig = z.infer<typeof IframeConfigSchema>
export type RichTextConfig = z.infer<typeof RichTextConfigSchema>

const layoutShape = {
  x: z.number().int().min(0).max(100).default(0),
  y: z.number().int().min(0).max(1000).default(0),
  w: z.number().int().min(1).max(12).default(4),
  h: z.number().int().min(1).max(60).default(6),
  /** Screen of the dashboard (0-based); absent = the first one. */
  page: z
    .number()
    .int()
    .min(0)
    .max(MAX_DASHBOARD_PAGES - 1)
    .optional(),
}

export const CreateCrmDashboardWidgetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('CHART'),
    config: ChartConfigSchema,
    ...layoutShape,
  }),
  z.object({
    type: z.literal('VIEW'),
    config: ViewConfigSchema,
    ...layoutShape,
  }),
  z.object({
    type: z.literal('IFRAME'),
    config: IframeConfigSchema,
    ...layoutShape,
  }),
  z.object({
    type: z.literal('RICH_TEXT'),
    config: RichTextConfigSchema,
    ...layoutShape,
  }),
  z.object({
    type: z.literal('SALES'),
    config: SalesConfigSchema,
    ...layoutShape,
  }),
])

export type CreateCrmDashboardWidgetDTO = z.infer<
  typeof CreateCrmDashboardWidgetSchema
>

/** Atualização parcial. `config` é validado contra o tipo do widget no service. */
export const UpdateCrmDashboardWidgetSchema = z
  .object({
    x: layoutShape.x.unwrap(),
    y: layoutShape.y.unwrap(),
    w: layoutShape.w.unwrap(),
    h: layoutShape.h.unwrap(),
    page: layoutShape.page.unwrap(),
    config: z.unknown(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar',
  })

export type UpdateCrmDashboardWidgetDTO = z.infer<
  typeof UpdateCrmDashboardWidgetSchema
>

/** Atualização em lote das posições/tamanhos (drag/resize do grid). */
export const CrmDashboardWidgetLayoutBatchSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        x: layoutShape.x.unwrap(),
        y: layoutShape.y.unwrap(),
        w: layoutShape.w.unwrap(),
        h: layoutShape.h.unwrap(),
        page: layoutShape.page.unwrap().optional(),
      }),
    )
    .max(200),
})

export type CrmDashboardWidgetLayoutBatchDTO = z.infer<
  typeof CrmDashboardWidgetLayoutBatchSchema
>

/* ------------------------------ TV and templates ----------------------------- */

export const CreateCrmDashboardTvLinkSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome ao link').max(80).default('TV'),
})

export type CreateCrmDashboardTvLinkDTO = z.infer<
  typeof CreateCrmDashboardTvLinkSchema
>

/** Ready-made dashboards a workspace can start from in one click. */
export const DASHBOARD_TEMPLATES = ['sales-tv'] as const
export type DashboardTemplate = (typeof DASHBOARD_TEMPLATES)[number]

export const CreateCrmDashboardFromTemplateSchema = z.object({
  template: z.enum(DASHBOARD_TEMPLATES),
  title: z.string().trim().min(1).max(200).optional(),
})

export type CreateCrmDashboardFromTemplateDTO = z.infer<
  typeof CreateCrmDashboardFromTemplateSchema
>
