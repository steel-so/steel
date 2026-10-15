import { z } from 'zod'
import { CrmDashboardSettingsSchema } from '@/src/schemas/crm-dashboard.schema'
import {
  CRM_REPORT_FILTER_OPERATORS,
  CRM_REPORT_SOURCES,
  CrmReportDataSchema,
  CrmReportQuerySchema,
} from '@/src/schemas/crm-report.schema'
import { SalesMetricSchema } from '@/src/schemas/crm-sales-metrics.schema'
import { dto } from '../../common'

/** DTOs de relatórios e dashboards do CRM (`types/crm-report.d.ts`, `types/crm-dashboard.d.ts`). */

const dateTime = () => z.iso.datetime()
const MODULES = ['SERVICE_DESK', 'CRM', 'COMMUNICATION'] as const

export const CrmReportDTO = dto(
  'CrmReport',
  z.object({
    id: z.string().meta({ example: 'ckw1rprt0000ab7d3k1e5xyz' }),
    workspaceId: z.string(),
    module: z.enum(MODULES).meta({
      description: 'Módulo dono do relatório (as rotas do CRM criam `CRM`).',
    }),
    name: z.string().meta({ example: 'Oportunidades por etapa' }),
    source: z.enum(CRM_REPORT_SOURCES).meta({
      description: 'Fonte legada (fonte do primeiro dataset).',
    }),
    columns: z.array(z.string()),
    filters: z.array(
      z.object({
        field: z.string(),
        operator: z.enum(CRM_REPORT_FILTER_OPERATORS),
        value: z.string(),
      }),
    ),
    groupBy: z.string().nullable(),
    sort: z
      .object({ field: z.string(), direction: z.enum(['asc', 'desc']) })
      .nullable(),
    query: CrmReportQuerySchema.meta({
      description:
        'Query normalizada (join/union). Sempre presente — sintetizada a partir dos campos legados quando não foi salva.',
    }),
    position: z.number(),
    createdById: z.string(),
    updatedById: z.string().nullable(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const CrmReportDataDTO = dto(
  'CrmReportData',
  CrmReportDataSchema.meta({
    description:
      'Resultado processado: `columns` (chave + rótulo) e `rows` indexadas por `column.key`; `total` = número de linhas.',
  }),
)

export const CrmDashboardDTO = dto(
  'CrmDashboard',
  z.object({
    id: z.string().meta({ example: 'ckw1dash0000ab7d3k1e5xyz' }),
    title: z.string().meta({ example: 'Vendas do trimestre' }),
    workspaceId: z.string(),
    module: z.enum(MODULES),
    createdById: z.string(),
    updatedById: z.string().nullable(),
    position: z.number(),
    settings: CrmDashboardSettingsSchema.meta({
      description:
        'Telas do painel (`pages`, 1 a 3 títulos) e rotação do modo TV (`rotateSeconds`, 0 = sem rotação).',
    }),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const CrmDashboardWidgetDTO = dto(
  'CrmDashboardWidget',
  z.object({
    id: z.string(),
    dashboardId: z.string(),
    type: z.enum(['CHART', 'VIEW', 'IFRAME', 'RICH_TEXT', 'SALES']),
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int().meta({ description: 'Largura em colunas (1–12).' }),
    h: z.number().int(),
    page: z.number().int().meta({ description: 'Tela do painel (0 a 2).' }),
    config: z.record(z.string(), z.unknown()).meta({
      description:
        'Configuração do tipo (`CHART`: gráfico; `VIEW`: tabela de uma fonte; `IFRAME`: `url`; `RICH_TEXT`: `html`; `SALES`: widget do kit de Vendas) — mesmo formato do corpo de criação.',
    }),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

const Person = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
})

export const CrmDashboardLookupsDTO = dto(
  'CrmDashboardLookups',
  z.object({
    pipelines: z.array(z.object({ id: z.string(), name: z.string() })),
    stages: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        pipelineId: z.string(),
        category: z.enum(['OPEN', 'WON', 'LOST']),
        color: z.string().nullable(),
      }),
    ),
    users: z.array(Person),
  }),
)

export const CrmDashboardTvLinkDTO = dto(
  'CrmDashboardTvLink',
  z.object({
    id: z.string(),
    dashboardId: z.string(),
    name: z.string().meta({ example: 'TV da sala de vendas' }),
    path: z.string().meta({
      description: 'Caminho da tela, `/tv/<token>`.',
      example: '/tv/9Qm2xL7aP0bC4dE6fG8hJ1kL3mN5pQ7r',
    }),
    createdById: z.string(),
    lastUsedAt: dateTime().nullable(),
    revokedAt: dateTime().nullable(),
    createdAt: dateTime(),
  }),
)

export const CrmSalesMetricDTO = dto(
  'CrmSalesMetric',
  SalesMetricSchema.meta({
    description:
      'Métrica do kit de Vendas; o formato depende de `kind` (meta, ranking, pipeline, previsão, conversão, ticket/ciclo, parados, propostas, placar do dia, vitórias).',
  }),
)

export const CrmDashboardTvBootDTO = dto(
  'CrmDashboardTvBoot',
  z.object({
    workspaceName: z.string(),
    timeZone: z.string().meta({ example: 'America/Sao_Paulo' }),
    dashboard: z.object({
      id: z.string(),
      title: z.string(),
      settings: CrmDashboardSettingsSchema,
    }),
    widgets: z.array(CrmDashboardWidgetDTO),
    lookups: CrmDashboardLookupsDTO,
  }),
)

export const CrmDashboardTvWidgetDataDTO = dto(
  'CrmDashboardTvWidgetData',
  z.object({
    type: z.enum(['SALES', 'ROWS']),
    metric: CrmSalesMetricDTO.optional(),
    rows: z.array(z.record(z.string(), z.unknown())).optional().meta({
      description:
        'Linhas da fonte do gráfico/tabela, sem dados de contato (e-mail, telefone, endereço, documentos e campos personalizados).',
    }),
  }),
)
