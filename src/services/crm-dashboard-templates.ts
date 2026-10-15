import type { CrmWidgetType } from '@prisma/client'
import type {
  CrmDashboardSettings,
  DashboardTemplate,
} from '@/src/schemas/crm-dashboard.schema'
import type { SalesConfig } from '@/src/schemas/crm-sales-metrics.schema'

export interface DashboardTemplateWidget {
  type: CrmWidgetType
  page: number
  x: number
  y: number
  w: number
  h: number
  config: Record<string, unknown>
}

export interface DashboardTemplateData {
  title: string
  settings: CrmDashboardSettings
  widgets: DashboardTemplateWidget[]
}

function sales(
  page: number,
  [x, y, w, h]: [number, number, number, number],
  config: Partial<SalesConfig> & Pick<SalesConfig, 'kind' | 'title'>,
): DashboardTemplateWidget {
  return {
    type: 'SALES',
    page,
    x,
    y,
    w,
    h,
    config: { period: 'month', stalledDays: 14, ...config },
  }
}

/**
 * "Vendas — TV": the sales kit on two screens of at most 6 blocks, sized to
 * read from across the room. Screen 1 is what moves the team every day
 * (goal, ranking, wins, today's scoreboard); screen 2 is the pipeline
 * health the leaders follow. The TV rotates between them every 30 s.
 */
const SALES_TV: DashboardTemplateData = {
  title: 'Vendas — TV',
  settings: { pages: ['Metas do mês', 'Pipeline e funil'], rotateSeconds: 30 },
  widgets: [
    sales(0, [0, 0, 5, 7], { kind: 'goal', title: 'Meta do mês' }),
    sales(0, [5, 0, 4, 7], {
      kind: 'ranking',
      title: 'Ranking de vendedores',
      limit: 6,
    }),
    sales(0, [9, 0, 3, 7], {
      kind: 'wins-feed',
      title: 'Vitórias recentes',
      limit: 5,
    }),
    sales(0, [0, 7, 12, 3], { kind: 'scoreboard', title: 'Placar do dia' }),
    sales(1, [0, 0, 6, 6], {
      kind: 'pipeline',
      title: 'Pipeline ponderado por etapa',
    }),
    sales(1, [6, 0, 3, 6], { kind: 'forecast', title: 'Previsão do mês' }),
    sales(1, [9, 0, 3, 6], {
      kind: 'conversion',
      title: 'Conversão do mês',
    }),
    sales(1, [0, 6, 3, 4], {
      kind: 'deal-stats',
      title: 'Ticket e ciclo médios',
    }),
    sales(1, [3, 6, 5, 4], {
      kind: 'stalled',
      title: 'Negócios parados',
      limit: 4,
    }),
    sales(1, [8, 6, 4, 4], {
      kind: 'proposals',
      title: 'Propostas aguardando',
      limit: 4,
    }),
  ],
}

export const DASHBOARD_TEMPLATE_DATA: Record<
  DashboardTemplate,
  DashboardTemplateData
> = {
  'sales-tv': SALES_TV,
}
