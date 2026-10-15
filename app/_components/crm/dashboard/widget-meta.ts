import {
  Award01Icon,
  BarChartHorizontalIcon,
  BarChartIcon,
  Calculator01Icon,
  ChartLineData01Icon,
  GlobeIcon,
  PieChartIcon,
  PresentationBarChart01Icon,
  Table01Icon,
  TextFontIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import {
  SD_SOURCE_FIELDS,
  SD_SOURCE_LABELS,
  SD_SOURCE_PATH,
} from '@/app/_components/servicedesk/dashboards/sd-source-fields'
import type {
  Aggregation,
  ChartSource,
  ChartType,
  CompareRange,
  DateBucket,
  Period,
  SocialMetric,
  ViewSource,
  WidgetType,
} from '@/src/schemas/crm-dashboard.schema'
import type {
  SalesKind,
  SalesPeriod,
} from '@/src/schemas/crm-sales-metrics.schema'

export type WidgetTypeMeta = {
  type: WidgetType
  label: string
  description: string
  icon: typeof PresentationBarChart01Icon
}

export const WIDGET_TYPE_META: WidgetTypeMeta[] = [
  {
    type: 'CHART',
    label: 'Gráfico',
    description: 'Gráficos de barras, linha, pizza ou agregação.',
    icon: PresentationBarChart01Icon,
  },
  {
    type: 'VIEW',
    label: 'Tabela',
    description: 'Tabela de registros de uma fonte de dados.',
    icon: Table01Icon,
  },
  {
    type: 'IFRAME',
    label: 'Incorporar',
    description: 'Incorpora uma página externa por URL.',
    icon: GlobeIcon,
  },
  {
    type: 'RICH_TEXT',
    label: 'Texto rico',
    description: 'Texto livre formatado.',
    icon: TextFontIcon,
  },
  {
    type: 'SALES',
    label: 'Vendas',
    description:
      'Meta, ranking, pipeline, vitórias e mais — prontos para a TV.',
    icon: Award01Icon,
  },
]

/** Tipos oferecidos no seletor: o kit de Vendas só existe no CRM. */
export function widgetTypesForBasePath(basePath: string): WidgetTypeMeta[] {
  return WIDGET_TYPE_META.filter(
    (meta) => meta.type !== 'SALES' || moduleOfBasePath(basePath) === 'CRM',
  )
}

export type ChartTypeMeta = {
  type: ChartType
  label: string
  icon: typeof BarChartIcon
}

export const CHART_TYPE_META: ChartTypeMeta[] = [
  { type: 'vertical', label: 'Barras verticais', icon: BarChartIcon },
  {
    type: 'horizontal',
    label: 'Barras horizontais',
    icon: BarChartHorizontalIcon,
  },
  { type: 'line', label: 'Linha', icon: ChartLineData01Icon },
  { type: 'pie', label: 'Pizza', icon: PieChartIcon },
  { type: 'aggregate', label: 'Agregação', icon: Calculator01Icon },
]

export type ViewField = { key: string; label: string }

/** Campos selecionáveis por fonte do widget "view" (chaves = campos do DTO). */
export const VIEW_SOURCE_FIELDS: Record<ViewSource, ViewField[]> = {
  companies: [
    { key: 'name', label: 'Nome' },
    { key: 'domain', label: 'Domínio' },
    { key: 'employeesCount', label: 'Funcionários' },
    { key: 'arr', label: 'ARR' },
    { key: 'icp', label: 'ICP' },
    { key: 'createdAt', label: 'Criado em' },
  ],
  people: [
    { key: 'name', label: 'Nome' },
    { key: 'emails', label: 'E-mails' },
    { key: 'phones', label: 'Telefones' },
    { key: 'city', label: 'Cidade' },
    { key: 'jobTitle', label: 'Cargo' },
    { key: 'createdAt', label: 'Criado em' },
  ],
  opportunities: [
    { key: 'name', label: 'Nome' },
    { key: 'stageId', label: 'Etapa' },
    { key: 'pipelineId', label: 'Pipeline' },
    { key: 'ownerId', label: 'Responsável' },
    { key: 'amount', label: 'Valor' },
    { key: 'probability', label: 'Probabilidade' },
    { key: 'source', label: 'Origem' },
    { key: 'closeDate', label: 'Fechamento' },
    { key: 'createdAt', label: 'Criado em' },
  ],
  leads: [
    { key: 'name', label: 'Nome' },
    { key: 'company', label: 'Empresa' },
    { key: 'source', label: 'Origem' },
    { key: 'channel', label: 'Canal' },
    { key: 'stage', label: 'Etapa' },
    { key: 'ownerId', label: 'Responsável' },
    { key: 'score', label: 'Pontuação' },
    { key: 'createdAt', label: 'Criado em' },
  ],
  tasks: [
    { key: 'title', label: 'Título' },
    { key: 'status', label: 'Status' },
    { key: 'assigneeId', label: 'Responsável' },
    { key: 'dueDate', label: 'Vencimento' },
    { key: 'createdAt', label: 'Criado em' },
  ],
  notes: [
    { key: 'title', label: 'Título' },
    { key: 'body', label: 'Conteúdo' },
    { key: 'createdAt', label: 'Criado em' },
  ],
  forms: [
    { key: 'name', label: 'Nome' },
    { key: 'status', label: 'Status' },
    { key: 'submissionCount', label: 'Submissões' },
    { key: 'publishedAt', label: 'Publicado em' },
    { key: 'createdAt', label: 'Criado em' },
  ],
  'landing-pages': [
    { key: 'title', label: 'Título' },
    { key: 'status', label: 'Status' },
    { key: 'viewsCount', label: 'Acessos' },
    { key: 'publishedAt', label: 'Publicado em' },
    { key: 'createdAt', label: 'Criado em' },
  ],
  'whatsapp-conversations': [
    { key: 'contactName', label: 'Contato' },
    { key: 'contactWaId', label: 'Telefone' },
    { key: 'status', label: 'Status' },
    { key: 'aiActive', label: 'IA ativa' },
    { key: 'aiHandoff', label: 'Transferida p/ humano' },
    { key: 'unreadCount', label: 'Não lidas' },
    { key: 'avgSentimentScore', label: 'Sentimento médio' },
    { key: 'sentimentLabel', label: 'Faixa de sentimento (humor)' },
    { key: 'lastMessageAt', label: 'Última mensagem' },
    { key: 'createdAt', label: 'Criado em' },
  ],
  'whatsapp-broadcasts': [
    { key: 'name', label: 'Nome' },
    { key: 'status', label: 'Status' },
    { key: 'recipientCount', label: 'Destinatários' },
    { key: 'sentCount', label: 'Enviados' },
    { key: 'failedCount', label: 'Falhas' },
    { key: 'scheduledAt', label: 'Agendado para' },
    { key: 'createdAt', label: 'Criado em' },
  ],
  ...SD_SOURCE_FIELDS,
}

export const VIEW_SOURCE_LABELS: Record<ViewSource, string> = {
  companies: 'Empresas',
  people: 'Pessoas',
  opportunities: 'Oportunidades',
  leads: 'Leads',
  tasks: 'Tarefas',
  notes: 'Notas',
  forms: 'Formulários',
  'landing-pages': 'Landing pages',
  'whatsapp-conversations': 'Conversas do WhatsApp',
  'whatsapp-broadcasts': 'Transmissões do WhatsApp',
  ...SD_SOURCE_LABELS,
}

/** Labels do chart: view sources + "socials". */
export const CHART_SOURCE_LABELS: Record<ChartSource, string> = {
  ...VIEW_SOURCE_LABELS,
  socials: 'Redes sociais',
}

/** Módulo dono de cada fonte — usado pra filtrar o dropdown por contexto
 * (um dashboard do CRM não deve oferecer fontes do WhatsApp, e vice-versa). */
export const SOURCE_MODULE: Record<
  ViewSource,
  'CRM' | 'COMMUNICATION' | 'SERVICE_DESK'
> = {
  companies: 'CRM',
  people: 'CRM',
  opportunities: 'CRM',
  leads: 'CRM',
  tasks: 'CRM',
  notes: 'CRM',
  forms: 'CRM',
  'landing-pages': 'CRM',
  'whatsapp-conversations': 'COMMUNICATION',
  'whatsapp-broadcasts': 'COMMUNICATION',
  'sd-tickets': 'SERVICE_DESK',
  'sd-ticket-costs': 'SERVICE_DESK',
  'sd-ticket-events': 'SERVICE_DESK',
  'sd-kb-articles': 'SERVICE_DESK',
}

/** Módulo do dashboard pelo segmento de API (`crm`, `whatsapp`, `servicedesk`). */
export function moduleOfBasePath(
  basePath: string,
): 'CRM' | 'COMMUNICATION' | 'SERVICE_DESK' {
  if (basePath === 'servicedesk') return 'SERVICE_DESK'
  if (basePath === 'whatsapp') return 'COMMUNICATION'
  return 'CRM'
}

/**
 * Fontes oferecidas no seletor: dashboards do ServiceDesk só veem as fontes
 * do ServiceDesk; CRM e Comunicação mantêm as fontes de ambos (sem as do
 * ServiceDesk).
 */
export function sourcesForBasePath<S extends ChartSource>(
  sources: readonly S[],
  basePath: string,
): S[] {
  const module = moduleOfBasePath(basePath)
  return sources.filter((source) => {
    const owner =
      source === 'socials' ? 'CRM' : SOURCE_MODULE[source as ViewSource]
    return module === 'SERVICE_DESK'
      ? owner === 'SERVICE_DESK'
      : owner !== 'SERVICE_DESK'
  })
}

/** Caminho de API por fonte (após `/api/workspaces/<id>/`). */
const SOURCE_PATH: Record<ViewSource, string> = {
  companies: 'crm/companies',
  people: 'crm/people',
  opportunities: 'crm/opportunities',
  leads: 'crm/leads',
  tasks: 'crm/tasks',
  notes: 'crm/notes',
  forms: 'crm/forms',
  'landing-pages': 'crm/landing-pages',
  'whatsapp-conversations': 'whatsapp/conversations',
  'whatsapp-broadcasts': 'whatsapp/broadcasts',
  ...SD_SOURCE_PATH,
}

/**
 * Fontes cujas linhas trazem ids de etapa, pipeline ou pessoa: só elas
 * buscam os nomes (`crm/dashboards/lookups`).
 */
export function sourceNeedsLookups(source: ChartSource): boolean {
  return (
    source === 'opportunities' ||
    source === 'leads' ||
    source === 'tasks' ||
    source === 'companies' ||
    source === 'notes'
  )
}

/** Traduz a fonte (valor do enum) para o caminho de API completo. */
export function sourceResource(source: ChartSource): string {
  if (source === 'socials') return ''
  return SOURCE_PATH[source]
}

export const COMPARE_RANGE_LABELS: Record<CompareRange, string> = {
  '7d': '7 dias',
  '30d': '30 dias',
}

export const SOCIAL_METRIC_LABELS: Record<SocialMetric, string> = {
  views: 'Visualizações',
  followers: 'Seguidores ganhos',
  impressions: 'Impressões (Ads)',
  clicks: 'Cliques (Ads)',
  conversions: 'Conversões (Ads)',
  cost: 'Investimento (Ads)',
}

export const AGGREGATION_LABELS: Record<Aggregation, string> = {
  auto: 'Automático (soma ou contagem)',
  count: 'Contagem de registros',
  sum: 'Soma',
  avg: 'Média',
  min: 'Mínimo',
  max: 'Máximo',
}

export const DATE_BUCKET_LABELS: Record<DateBucket, string> = {
  day: 'Por dia',
  week: 'Por semana',
  month: 'Por mês',
}

export const PERIOD_LABELS: Record<Period, string> = {
  today: 'Hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  month: 'Mês atual',
  year: 'Ano atual',
}

/* ------------------------------- kit de Vendas ------------------------------ */

export interface SalesKindMeta {
  kind: SalesKind
  label: string
  description: string
  /** Tamanho inicial no grid (12 colunas). */
  size: { w: number; h: number }
  /** Campos de configuração que o widget usa. */
  uses: {
    period?: boolean
    pipeline?: boolean
    stalledDays?: boolean
    limit?: number
  }
}

export const SALES_KIND_META: SalesKindMeta[] = [
  {
    kind: 'goal',
    label: 'Meta do mês',
    description: 'Ganho × meta, % atingido, falta, dias úteis e ritmo.',
    size: { w: 5, h: 7 },
    uses: { period: true },
  },
  {
    kind: 'ranking',
    label: 'Ranking de vendedores',
    description: 'Valor ganho e % da meta individual, pódio em destaque.',
    size: { w: 4, h: 7 },
    uses: { period: true, limit: 6 },
  },
  {
    kind: 'wins-feed',
    label: 'Feed de vitórias',
    description: 'Últimos ganhos, atualizado a cada 15 s.',
    size: { w: 3, h: 7 },
    uses: { limit: 5 },
  },
  {
    kind: 'scoreboard',
    label: 'Placar do dia',
    description: 'Vendas, valor, reuniões, atividades e leads de hoje.',
    size: { w: 12, h: 3 },
    uses: {},
  },
  {
    kind: 'pipeline',
    label: 'Pipeline ponderado',
    description: 'Abertas por etapa: valor e valor × probabilidade.',
    size: { w: 6, h: 6 },
    uses: { pipeline: true },
  },
  {
    kind: 'forecast',
    label: 'Previsão',
    description: 'Comprometido, ponderado e melhor cenário do período.',
    size: { w: 3, h: 6 },
    uses: { period: true, pipeline: true },
  },
  {
    kind: 'conversion',
    label: 'Conversão',
    description: 'Lead → oportunidade → ganho, contra o período anterior.',
    size: { w: 3, h: 6 },
    uses: { period: true },
  },
  {
    kind: 'deal-stats',
    label: 'Ticket e ciclo médios',
    description: 'Valor médio e dias até o ganho, com tendência.',
    size: { w: 3, h: 4 },
    uses: { period: true },
  },
  {
    kind: 'stalled',
    label: 'Negócios parados',
    description: 'Abertas sem atividade há N dias.',
    size: { w: 5, h: 4 },
    uses: { pipeline: true, stalledDays: true, limit: 4 },
  },
  {
    kind: 'proposals',
    label: 'Propostas',
    description: 'Aguardando resposta e vencendo nesta semana.',
    size: { w: 4, h: 4 },
    uses: { limit: 4 },
  },
]

export function salesKindMeta(kind: SalesKind): SalesKindMeta {
  return (
    SALES_KIND_META.find((meta) => meta.kind === kind) ?? SALES_KIND_META[0]
  )
}

export const SALES_PERIOD_LABELS: Record<SalesPeriod, string> = {
  month: 'Mês atual',
  quarter: 'Trimestre atual',
}
