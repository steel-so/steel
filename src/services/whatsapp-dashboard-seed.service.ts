import type { Prisma } from '@prisma/client'
import type z from 'zod'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import {
  CrmDashboardRepository,
  CrmDashboardWidgetRepository,
} from '@/src/repositories/crm-dashboard.repository'
import { CrmReportRepository } from '@/src/repositories/crm-report.repository'
import {
  ChartConfigSchema,
  type CreateCrmDashboardWidgetDTO,
  ViewConfigSchema,
} from '@/src/schemas/crm-dashboard.schema'
import type { CreateCrmReportDTO } from '@/src/schemas/crm-report.schema'

/**
 * Dashboards e relatórios padrão do módulo COMMUNICATION (zap) — cobrem o
 * caso de workspaces que não querem montar seus próprios dashboards do zero.
 * Idempotente por título/nome: seguro pra rodar de novo (toggle do módulo,
 * backfill de workspaces já habilitados).
 */

const ATENDIMENTO_TITLE = 'Atendimento'
const CAMPANHAS_TITLE = 'Campanhas'
const TEMPOS_TITLE = 'Tempos de atendimento'
const CONVERSAS_REPORT_NAME = 'Conversas do WhatsApp'
const TRANSMISSOES_REPORT_NAME = 'Transmissões do WhatsApp'

type Layout = { x: number; y: number; w: number; h: number }

function chartWidget(
  config: z.input<typeof ChartConfigSchema>,
  layout: Layout,
): CreateCrmDashboardWidgetDTO {
  return { type: 'CHART', config: ChartConfigSchema.parse(config), ...layout }
}

function viewWidget(
  config: z.input<typeof ViewConfigSchema>,
  layout: Layout,
): CreateCrmDashboardWidgetDTO {
  return { type: 'VIEW', config: ViewConfigSchema.parse(config), ...layout }
}

const ATENDIMENTO_WIDGETS: CreateCrmDashboardWidgetDTO[] = [
  chartWidget(
    {
      chartType: 'aggregate',
      source: 'whatsapp-conversations',
      filters: [{ field: 'status', operator: 'not_equals', value: 'CLOSED' }],
      xAxisName: 'Conversas abertas',
    },
    { x: 0, y: 0, w: 3, h: 4 },
  ),
  chartWidget(
    {
      chartType: 'aggregate',
      source: 'whatsapp-conversations',
      filters: [{ field: 'aiActive', operator: 'equals', value: 'true' }],
      xAxisName: 'Com IA ativa',
    },
    { x: 3, y: 0, w: 3, h: 4 },
  ),
  chartWidget(
    {
      chartType: 'aggregate',
      source: 'whatsapp-conversations',
      filters: [{ field: 'aiHandoff', operator: 'equals', value: 'true' }],
      compareRange: '7d',
      xAxisName: 'Transferidas p/ humano (7d)',
    },
    { x: 6, y: 0, w: 3, h: 4 },
  ),
  chartWidget(
    {
      chartType: 'aggregate',
      source: 'whatsapp-conversations',
      compareRange: '30d',
      xAxisName: 'Conversas (30 dias)',
    },
    { x: 9, y: 0, w: 3, h: 4 },
  ),
  chartWidget(
    {
      chartType: 'pie',
      source: 'whatsapp-conversations',
      xField: 'status',
      xAxisName: 'Status',
    },
    { x: 0, y: 4, w: 4, h: 6 },
  ),
  chartWidget(
    {
      chartType: 'horizontal',
      source: 'whatsapp-conversations',
      xField: 'assignedUserId',
      xAxisName: 'Atendente',
      yAxisName: 'Conversas',
    },
    { x: 4, y: 4, w: 4, h: 6 },
  ),
  chartWidget(
    {
      chartType: 'line',
      source: 'whatsapp-conversations',
      xField: 'createdAt',
      xAxisName: 'Dia',
      yAxisName: 'Novas conversas',
    },
    { x: 8, y: 4, w: 4, h: 6 },
  ),
  viewWidget(
    {
      source: 'whatsapp-conversations',
      fields: [
        'contactName',
        'contactWaId',
        'assignedUserId',
        'unreadCount',
        'status',
        'lastMessageAt',
      ],
      filters: [{ field: 'unreadCount', operator: 'not_equals', value: '0' }],
      sort: [{ field: 'lastMessageAt', direction: 'desc' }],
    },
    { x: 0, y: 10, w: 12, h: 6 },
  ),
]

const CAMPANHAS_WIDGETS: CreateCrmDashboardWidgetDTO[] = [
  chartWidget(
    {
      chartType: 'aggregate',
      source: 'whatsapp-broadcasts',
      filters: [{ field: 'status', operator: 'equals', value: 'RUNNING' }],
      xAxisName: 'Em execução',
    },
    { x: 0, y: 0, w: 4, h: 4 },
  ),
  chartWidget(
    {
      chartType: 'aggregate',
      source: 'whatsapp-broadcasts',
      yField: 'sentCount',
      compareRange: '30d',
      xAxisName: 'Enviados (30 dias)',
    },
    { x: 4, y: 0, w: 4, h: 4 },
  ),
  chartWidget(
    {
      chartType: 'aggregate',
      source: 'whatsapp-broadcasts',
      yField: 'failedCount',
      compareRange: '30d',
      xAxisName: 'Falhas (30 dias)',
    },
    { x: 8, y: 0, w: 4, h: 4 },
  ),
  chartWidget(
    {
      chartType: 'pie',
      source: 'whatsapp-broadcasts',
      xField: 'status',
      xAxisName: 'Status',
    },
    { x: 0, y: 4, w: 4, h: 6 },
  ),
  chartWidget(
    {
      chartType: 'vertical',
      source: 'whatsapp-broadcasts',
      xField: 'name',
      yField: 'sentCount',
      xAxisName: 'Campanha',
      yAxisName: 'Enviados',
    },
    { x: 4, y: 4, w: 8, h: 6 },
  ),
  chartWidget(
    {
      chartType: 'line',
      source: 'whatsapp-broadcasts',
      xField: 'scheduledAt',
      xAxisName: 'Data agendada',
      yAxisName: 'Transmissões',
    },
    { x: 0, y: 10, w: 12, h: 5 },
  ),
  viewWidget(
    {
      source: 'whatsapp-broadcasts',
      fields: [
        'name',
        'status',
        'recipientCount',
        'sentCount',
        'failedCount',
        'scheduledAt',
      ],
      sort: [{ field: 'createdAt', direction: 'desc' }],
    },
    { x: 0, y: 15, w: 12, h: 6 },
  ),
]

const OPEN_FILTER = [
  { field: 'isOpen', operator: 'equals', value: 'true' },
] as const

const TEMPOS_WIDGETS: CreateCrmDashboardWidgetDTO[] = [
  chartWidget(
    {
      chartType: 'aggregate',
      source: 'whatsapp-attendances',
      yField: 'avgResponseMinutes',
      aggregation: 'avg',
      valueFormat: 'duration',
      xAxisName: 'Tempo médio de resposta',
    },
    { x: 0, y: 0, w: 3, h: 4 },
  ),
  chartWidget(
    {
      chartType: 'aggregate',
      source: 'whatsapp-attendances',
      yField: 'openMinutes',
      aggregation: 'avg',
      filters: [...OPEN_FILTER],
      valueFormat: 'duration',
      xAxisName: 'Tempo médio das conversas abertas',
    },
    { x: 3, y: 0, w: 3, h: 4 },
  ),
  chartWidget(
    {
      chartType: 'aggregate',
      source: 'whatsapp-attendances',
      yField: 'waitingMinutes',
      aggregation: 'max',
      valueFormat: 'duration',
      color: '#dc2626',
      xAxisName: 'Maior espera agora',
    },
    { x: 6, y: 0, w: 3, h: 4 },
  ),
  chartWidget(
    {
      chartType: 'aggregate',
      source: 'whatsapp-attendances',
      yField: 'durationMinutes',
      aggregation: 'avg',
      valueFormat: 'duration',
      xAxisName: 'Duração média das encerradas',
    },
    { x: 9, y: 0, w: 3, h: 4 },
  ),
  chartWidget(
    {
      chartType: 'horizontal',
      source: 'whatsapp-attendances',
      xField: 'attendant',
      yField: 'avgResponseMinutes',
      aggregation: 'avg',
      xAxisName: 'Atendente',
      valueFormat: 'duration',
      yAxisName: 'Tempo médio de resposta',
    },
    { x: 0, y: 4, w: 6, h: 6 },
  ),
  chartWidget(
    {
      chartType: 'horizontal',
      source: 'whatsapp-attendances',
      xField: 'attendant',
      yField: 'openMinutes',
      aggregation: 'avg',
      filters: [...OPEN_FILTER],
      xAxisName: 'Atendente',
      valueFormat: 'duration',
      yAxisName: 'Tempo médio das abertas',
    },
    { x: 6, y: 4, w: 6, h: 6 },
  ),
  chartWidget(
    {
      chartType: 'line',
      source: 'whatsapp-attendances',
      xField: 'createdAt',
      yField: 'avgResponseMinutes',
      aggregation: 'avg',
      dateBucket: 'day',
      xAxisName: 'Dia',
      valueFormat: 'duration',
      yAxisName: 'Tempo médio de resposta',
    },
    { x: 0, y: 10, w: 12, h: 5 },
  ),
  viewWidget(
    {
      source: 'whatsapp-attendances',
      title: 'Quem está esperando uma pessoa agora',
      fields: [
        'contactName',
        'contactPhone',
        'attendant',
        'team',
        'waitingMinutes',
        'openMinutes',
        'lastInboundAt',
      ],
      filters: [{ field: 'isWaiting', operator: 'equals', value: 'true' }],
      sort: [{ field: 'waitingMinutes', direction: 'desc' }],
      limit: 50,
    },
    { x: 0, y: 15, w: 12, h: 6 },
  ),
]

const CONVERSAS_REPORT: Omit<CreateCrmReportDTO, 'name'> = {
  source: 'whatsapp_conversation',
  columns: [
    'contactName',
    'contactWaId',
    'status',
    'assignedUserId',
    'aiActive',
    'aiHandoff',
    'unreadCount',
    'avgSentimentScore',
    'lastMessageAt',
    'createdAt',
  ],
  filters: [],
  sort: { field: 'lastMessageAt', direction: 'desc' },
}

const TRANSMISSOES_REPORT: Omit<CreateCrmReportDTO, 'name'> = {
  source: 'whatsapp_broadcast',
  columns: [
    'name',
    'status',
    'recipientCount',
    'sentCount',
    'failedCount',
    'scheduledAt',
    'createdAt',
  ],
  filters: [],
  sort: { field: 'createdAt', direction: 'desc' },
}

async function createDashboardIfMissing(
  workspaceId: string,
  actorId: string,
  title: string,
  widgets: CreateCrmDashboardWidgetDTO[],
): Promise<Result<void>> {
  const existing = await CrmDashboardRepository.listByWorkspace(
    workspaceId,
    'COMMUNICATION',
  )
  if (!existing.ok) return existing
  if (existing.value.some((dashboard) => dashboard.title === title)) {
    return ok(undefined)
  }

  const dashboard = await CrmDashboardRepository.create({
    workspaceId,
    createdById: actorId,
    title,
    module: 'COMMUNICATION',
  })
  if (!dashboard.ok) return dashboard

  for (const widget of widgets) {
    const created = await CrmDashboardWidgetRepository.create({
      dashboardId: dashboard.value.id,
      type: widget.type,
      x: widget.x,
      y: widget.y,
      w: widget.w,
      h: widget.h,
      config: widget.config as Prisma.InputJsonValue,
    })
    if (!created.ok) {
      logger.error('whatsapp_dashboard_seed.widget_failed', {
        workspaceId,
        dashboardTitle: title,
        error: created.error,
      })
    }
  }

  auditMutation({
    entity: 'crm_dashboard',
    action: 'create',
    actorId,
    targetId: dashboard.value.id,
    meta: { seeded: true, module: 'COMMUNICATION', title },
  })

  return ok(undefined)
}

async function createReportIfMissing(
  workspaceId: string,
  actorId: string,
  name: string,
  spec: Omit<CreateCrmReportDTO, 'name'>,
): Promise<Result<void>> {
  const existing = await CrmReportRepository.listByWorkspace(
    workspaceId,
    'COMMUNICATION',
  )
  if (!existing.ok) return existing
  if (existing.value.some((report) => report.name === name)) {
    return ok(undefined)
  }

  const report = await CrmReportRepository.create({
    workspaceId,
    createdById: actorId,
    module: 'COMMUNICATION',
    name,
    source: spec.source,
    columns: spec.columns as Prisma.InputJsonValue,
    filters: spec.filters as Prisma.InputJsonValue,
    groupBy: spec.groupBy,
    sort: spec.sort as Prisma.InputJsonValue | undefined,
  })
  if (!report.ok) return report

  auditMutation({
    entity: 'crm_report',
    action: 'create',
    actorId,
    targetId: report.value.id,
    meta: { seeded: true, module: 'COMMUNICATION', name },
  })

  return ok(undefined)
}

export const WhatsAppDashboardSeedService = {
  /**
   * Cria os dashboards "Atendimento"/"Campanhas"/"Tempos de atendimento" e os relatórios de
   * conversas/transmissões, pulando o que já existir (por título/nome).
   */
  async seedDefaults(
    workspaceId: string,
    actorId: string,
  ): Promise<Result<void>> {
    const dashboard1 = await createDashboardIfMissing(
      workspaceId,
      actorId,
      ATENDIMENTO_TITLE,
      ATENDIMENTO_WIDGETS,
    )
    if (!dashboard1.ok) return dashboard1

    const dashboard2 = await createDashboardIfMissing(
      workspaceId,
      actorId,
      CAMPANHAS_TITLE,
      CAMPANHAS_WIDGETS,
    )
    if (!dashboard2.ok) return dashboard2

    const dashboard3 = await createDashboardIfMissing(
      workspaceId,
      actorId,
      TEMPOS_TITLE,
      TEMPOS_WIDGETS,
    )
    if (!dashboard3.ok) return dashboard3

    const report1 = await createReportIfMissing(
      workspaceId,
      actorId,
      CONVERSAS_REPORT_NAME,
      CONVERSAS_REPORT,
    )
    if (!report1.ok) return report1

    const report2 = await createReportIfMissing(
      workspaceId,
      actorId,
      TRANSMISSOES_REPORT_NAME,
      TRANSMISSOES_REPORT,
    )
    if (!report2.ok) return report2

    return ok(undefined)
  },
}
