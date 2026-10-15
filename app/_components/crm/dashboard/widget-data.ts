import type {
  Aggregation,
  ChartConfig,
  ChartSource,
  DateBucket,
  Period,
  ViewConfig,
  ViewSource,
} from '@/src/schemas/crm-dashboard.schema'
import type { CrmDashboardLookupsDTO } from '@/types/crm-dashboard'

export type Row = Record<string, unknown>
type Filter = ViewConfig['filters'][number]

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value)
}

/** Valor de uma célula como texto legível (para tabela e categorias). */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'string' && isIsoDate(value)) {
    return dateFmt.format(new Date(value))
  }
  return String(value)
}

/* ------------------------------ nomes dos ids ------------------------------ */

/** Campo → (id → nome): resolve `stageId`, `ownerId`… para exibição. */
export type RefLabels = Record<string, Map<string, string>>

/** Rótulos fixos de enums que aparecem crus nas linhas. */
const LEAD_STAGE_LABELS: [string, string][] = [
  ['RECEIVED', 'Recebido'],
  ['IN_CONTACT', 'Em contato'],
  ['QUALIFIED', 'Qualificado'],
  ['OPPORTUNITY', 'Oportunidade'],
  ['PROPOSAL', 'Proposta'],
  ['CLOSED', 'Fechado'],
]

/**
 * Mapas de nome por campo a partir dos lookups do workspace. Os campos de
 * pessoa (`ownerId`, `assigneeId`…) usam os membros; um id sem membro
 * (quem saiu do workspace) continua aparecendo cru.
 */
export function refLabelsOf(
  lookups: CrmDashboardLookupsDTO | null | undefined,
): RefLabels {
  if (!lookups) return {}
  const users = new Map(lookups.users.map((user) => [user.id, user.name]))
  return {
    stageId: new Map(lookups.stages.map((stage) => [stage.id, stage.name])),
    pipelineId: new Map(lookups.pipelines.map((p) => [p.id, p.name])),
    ownerId: users,
    assigneeId: users,
    responsibleId: users,
    createdById: users,
    updatedById: users,
    stage: new Map(LEAD_STAGE_LABELS),
  }
}

/** Texto de uma célula, trocando ids conhecidos pelo nome. */
export function formatCell(
  field: string,
  value: unknown,
  labels?: RefLabels,
): string {
  if (typeof value === 'string') {
    const label = labels?.[field]?.get(value)
    if (label) return label
  }
  return formatValue(value)
}

export function passesFilters(
  row: Row,
  filters: Filter[],
  labels?: RefLabels,
): boolean {
  return filters.every((filter) => {
    const raw = row[filter.field]
    const text = Array.isArray(raw) ? raw.join(' ') : String(raw ?? '')
    const needle = (filter.value ?? '').toLowerCase()
    const hay = text.toLowerCase()
    // "Etapa igual a Proposta enviada" casa pelo nome, não só pelo id.
    const label =
      typeof raw === 'string'
        ? (labels?.[filter.field]?.get(raw)?.toLowerCase() ?? null)
        : null
    switch (filter.operator) {
      case 'contains':
        return hay.includes(needle) || (label?.includes(needle) ?? false)
      case 'equals':
        return hay === needle || label === needle
      case 'not_equals':
        return hay !== needle && label !== needle
      case 'is_empty':
        return raw === null || raw === undefined || text === ''
      case 'is_not_empty':
        return raw !== null && raw !== undefined && text !== ''
      default:
        return true
    }
  })
}

function compareCells(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', {
    numeric: true,
  })
}

/** Ordena por campos; números comparam como números, vazios vão para o fim. */
export function sortRows(rows: Row[], config: ViewConfig): Row[] {
  if (config.sort.length === 0) return rows
  return [...rows].sort((a, b) => {
    for (const { field, direction } of config.sort) {
      const aEmpty = a[field] === null || a[field] === undefined
      const bEmpty = b[field] === null || b[field] === undefined
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
      const cmp = compareCells(a[field], b[field])
      if (cmp !== 0) return direction === 'asc' ? cmp : -cmp
    }
    return 0
  })
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const SENTIMENT_POSITIVE_THRESHOLD = 0.2
const SENTIMENT_NEGATIVE_THRESHOLD = -0.2

function sentimentLabelFor(score: unknown): string {
  const n = toNumber(score)
  if (n === null) return 'Sem classificação'
  if (n >= SENTIMENT_POSITIVE_THRESHOLD) return 'Positivo'
  if (n <= SENTIMENT_NEGATIVE_THRESHOLD) return 'Negativo'
  return 'Neutro'
}

/**
 * Enriquece as linhas com campos calculados no cliente (não vêm do DTO da
 * API). Hoje só a faixa de sentimento das conversas de WhatsApp, derivada de
 * `avgSentimentScore` — que já é calculado pelo job de análise de sentimento
 * (src/lib/queue/processors/whatsapp-sentiment.ts), aqui só é bucketizado
 * para virar categoria de gráfico/tabela. As fontes do ServiceDesk já vêm
 * com os campos derivados do servidor.
 */
export function withDerivedFields(
  source: ChartSource | ViewSource,
  rows: Row[],
): Row[] {
  if (source !== 'whatsapp-conversations') return rows
  return rows.map((row) => ({
    ...row,
    sentimentLabel: sentimentLabelFor(row.avgSentimentScore),
  }))
}

const SINGLE_SERIES = 'Total'
const DAY_MS = 86_400_000

/* --------------------------------- período --------------------------------- */

function startOfLocalDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate())
}

/** Início da janela de `period` (fuso do navegador). */
export function periodStart(period: Period, now: Date = new Date()): Date {
  switch (period) {
    case 'today':
      return startOfLocalDay(now)
    case '7d':
      return new Date(now.getTime() - 7 * DAY_MS)
    case '30d':
      return new Date(now.getTime() - 30 * DAY_MS)
    case '90d':
      return new Date(now.getTime() - 90 * DAY_MS)
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1)
    case 'year':
      return new Date(now.getFullYear(), 0, 1)
  }
}

type WindowConfig = {
  period?: Period
  periodField?: string
  source?: ChartSource | ViewSource
}

function defaultDateField(source?: ChartSource | ViewSource): string {
  return source === 'socials' ? 'date' : 'createdAt'
}

function toTime(value: unknown): number | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? null : t
}

/** Linhas cuja data (`periodField`, padrão `createdAt`) cai no período. */
export function applyPeriod(
  rows: Row[],
  config: WindowConfig,
  now: Date = new Date(),
): Row[] {
  if (!config.period) return rows
  const field = config.periodField || defaultDateField(config.source)
  const from = periodStart(config.period, now).getTime()
  const to = now.getTime()
  return rows.filter((row) => {
    const t = toTime(row[field])
    return t !== null && t >= from && t <= to
  })
}

/* ----------------------------- baldes de data ------------------------------ */

const monthFmt = new Intl.DateTimeFormat('pt-BR', {
  month: 'short',
  year: 'numeric',
})
const dayFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
})

function isoKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dd}`
}

/**
 * Chave ordenável + rótulo do balde (dia, semana iniciando na segunda, mês)
 * de uma data. `null` quando o valor não é data.
 */
export function dateBucketOf(
  value: unknown,
  bucket: DateBucket,
): { key: string; label: string } | null {
  const t = toTime(value)
  if (t === null) return null
  const day = startOfLocalDay(new Date(t))
  if (bucket === 'month') {
    const first = new Date(day.getFullYear(), day.getMonth(), 1)
    return { key: isoKey(first), label: monthFmt.format(first) }
  }
  if (bucket === 'week') {
    const offset = (day.getDay() + 6) % 7
    const monday = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate() - offset,
    )
    return { key: isoKey(monday), label: `Sem. ${dayFmt.format(monday)}` }
  }
  return { key: isoKey(day), label: dayFmt.format(day) }
}

/* -------------------------------- agregação -------------------------------- */

type Acc = {
  count: number
  numbers: number
  sum: number
  min: number
  max: number
}

function newAcc(): Acc {
  return {
    count: 0,
    numbers: 0,
    sum: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
  }
}

function push(acc: Acc, value: number | null) {
  acc.count += 1
  if (value === null) return
  acc.numbers += 1
  acc.sum += value
  if (value < acc.min) acc.min = value
  if (value > acc.max) acc.max = value
}

type Mode = Exclude<Aggregation, 'auto'>

/**
 * Modo efetivo: `auto` (legado) soma o campo de valor quando há número nele,
 * senão conta. Sem campo de valor, qualquer modo vira contagem.
 */
function effectiveAggregation(
  config: Pick<ChartConfig, 'aggregation' | 'yField'>,
  rows: Row[],
): Mode {
  const mode = config.aggregation ?? 'auto'
  if (!config.yField) return 'count'
  if (mode !== 'auto') return mode
  const field = config.yField
  return rows.some((row) => toNumber(row[field]) !== null) ? 'sum' : 'count'
}

function resultOf(acc: Acc, mode: Mode): number {
  switch (mode) {
    case 'count':
      return acc.count
    case 'sum':
      return acc.sum
    case 'avg':
      return acc.numbers === 0 ? 0 : acc.sum / acc.numbers
    case 'min':
      return acc.numbers === 0 ? 0 : acc.min
    case 'max':
      return acc.numbers === 0 ? 0 : acc.max
  }
}

export type ChartData = {
  categories: string[]
  seriesKeys: string[]
  valueAt: (category: string, series: string) => number
  totalOf: (category: string) => number
}

/**
 * Agrega registros conforme a config do chart: filtros → período →
 * categoria (com balde de data opcional) × série → valor (`aggregation`).
 * Datas em balde saem em ordem cronológica quando não há outra ordenação.
 */
export function aggregateChart(
  rows: Row[],
  config: ChartConfig,
  now: Date = new Date(),
  labels?: RefLabels,
): ChartData {
  const empty: ChartData = {
    categories: [],
    seriesKeys: [],
    valueAt: () => 0,
    totalOf: () => 0,
  }
  if (!config.xField) return empty
  const xField = config.xField

  const filtered = applyPeriod(
    rows.filter((row) => passesFilters(row, config.filters, labels)),
    config,
    now,
  )
  const mode = effectiveAggregation(config, filtered)

  const order: string[] = []
  const sortKey = new Map<string, string>()
  const accs = new Map<string, Map<string, Acc>>()
  const seriesSet = new Set<string>()

  for (const row of filtered) {
    const raw = row[xField]
    const bucket = config.dateBucket
      ? dateBucketOf(raw, config.dateBucket)
      : null
    const category = bucket ? bucket.label : formatCell(xField, raw, labels)
    const series = config.groupBy
      ? formatCell(config.groupBy, row[config.groupBy], labels)
      : SINGLE_SERIES
    seriesSet.add(series)
    let inner = accs.get(category)
    if (!inner) {
      inner = new Map()
      accs.set(category, inner)
      order.push(category)
      if (bucket) sortKey.set(category, bucket.key)
    }
    const acc = inner.get(series) ?? newAcc()
    push(acc, config.yField ? toNumber(row[config.yField]) : null)
    inner.set(series, acc)
  }

  const values = new Map<string, Map<string, number>>()
  for (const [category, inner] of accs) {
    const out = new Map<string, number>()
    for (const [series, acc] of inner) out.set(series, resultOf(acc, mode))
    values.set(category, out)
  }

  const totalOf = (category: string): number => {
    const inner = values.get(category)
    if (!inner) return 0
    let sum = 0
    for (const v of inner.values()) sum += v
    return sum
  }

  let categories = [...order]
  if (config.ySort !== 'none') {
    categories.sort((a, b) =>
      config.ySort === 'asc'
        ? totalOf(a) - totalOf(b)
        : totalOf(b) - totalOf(a),
    )
  } else if (config.xSort !== 'none') {
    categories.sort((a, b) => {
      const cmp = (sortKey.get(a) ?? a).localeCompare(
        sortKey.get(b) ?? b,
        'pt-BR',
        { numeric: true },
      )
      return config.xSort === 'asc' ? cmp : -cmp
    })
  } else if (config.dateBucket) {
    categories.sort((a, b) =>
      (sortKey.get(a) ?? '').localeCompare(sortKey.get(b) ?? ''),
    )
  }

  if (config.omitZero || config.hideEmpty) {
    categories = categories.filter((c) => totalOf(c) !== 0)
  }
  if (config.limit) categories = categories.slice(0, config.limit)

  if (config.cumulative) {
    const running = new Map<string, number>()
    for (const category of categories) {
      const inner = values.get(category) as Map<string, number>
      for (const series of seriesSet) {
        const next = (inner.get(series) ?? 0) + (running.get(series) ?? 0)
        running.set(series, next)
        inner.set(series, next)
      }
    }
  }

  return {
    categories,
    seriesKeys: [...seriesSet],
    valueAt: (category, series) => values.get(category)?.get(series) ?? 0,
    totalOf,
  }
}

/** Valor único das linhas conforme o modo de agregação. */
function reduceRows(rows: Row[], config: ChartConfig): number {
  const mode = effectiveAggregation(config, rows)
  const acc = newAcc()
  for (const row of rows) {
    push(acc, config.yField ? toNumber(row[config.yField]) : null)
  }
  return resultOf(acc, mode)
}

/** Valor único do widget "aggregate" (filtros + período + agregação). */
export function aggregateTotal(
  rows: Row[],
  config: ChartConfig,
  now: Date = new Date(),
  labels?: RefLabels,
): number {
  const filtered = applyPeriod(
    rows.filter((row) => passesFilters(row, config.filters, labels)),
    config,
    now,
  )
  return reduceRows(filtered, config)
}

const COMPARE_RANGE_DAYS: Record<
  NonNullable<ChartConfig['compareRange']>,
  number
> = {
  '7d': 7,
  '30d': 30,
}

export type CompareResult = {
  current: number
  previous: number
  changePct: number | null
}

/**
 * Compara o valor do período atual (`compareRange` dias) com o período
 * imediatamente anterior (mesmo tamanho). `null` quando `compareRange` não
 * está configurado. Campo de data: `periodField`, senão `date` para a fonte
 * "socials" (série diária) e `createdAt` para as demais. Com comparação, o
 * `period` do widget é ignorado (a janela é a da comparação).
 */
export function aggregateCompare(
  rows: Row[],
  config: ChartConfig,
  now: Date = new Date(),
  labels?: RefLabels,
): CompareResult | null {
  if (!config.compareRange) return null

  const dateField = config.periodField || defaultDateField(config.source)
  const days = COMPARE_RANGE_DAYS[config.compareRange]
  const end = now.getTime()
  const currentStart = end - days * DAY_MS
  const previousStart = end - days * 2 * DAY_MS

  const filtered = rows.filter((row) =>
    passesFilters(row, config.filters, labels),
  )
  const currentRows: Row[] = []
  const previousRows: Row[] = []

  for (const row of filtered) {
    const t = toTime(row[dateField])
    if (t === null) continue
    if (t >= currentStart && t <= end) currentRows.push(row)
    else if (t >= previousStart && t < currentStart) previousRows.push(row)
  }

  const current = reduceRows(currentRows, config)
  const previous = reduceRows(previousRows, config)
  const changePct =
    previous === 0 ? null : ((current - previous) / previous) * 100

  return { current, previous, changePct }
}

/**
 * Número formatado em pt-BR. Sem `decimals`: médias com até 1 casa, o resto
 * inteiro quando o valor é inteiro.
 */
export function formatAggregate(
  value: number,
  config: Pick<ChartConfig, 'decimals' | 'aggregation'>,
): string {
  if (config.decimals !== undefined) {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: config.decimals,
      maximumFractionDigits: config.decimals,
    }).format(value)
  }
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits:
      config.aggregation === 'avg' || !Number.isInteger(value) ? 1 : 0,
  }).format(value)
}

/** Período + filtros + ordenação + limite da view (tabela). */
export function viewRows(
  rows: Row[],
  config: ViewConfig,
  now: Date = new Date(),
  labels?: RefLabels,
): Row[] {
  const filtered = applyPeriod(
    rows.filter((row) => passesFilters(row, config.filters, labels)),
    config,
    now,
  )
  const sorted = sortRows(filtered, config)
  return config.limit ? sorted.slice(0, config.limit) : sorted
}
