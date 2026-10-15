'use client'

import { SalesWidget } from '@/app/_components/crm/dashboard/sales/sales-widget'
import { ChartWidget } from '@/app/_components/crm/dashboard/widgets/chart-widget'
import { IframeWidget } from '@/app/_components/crm/dashboard/widgets/iframe-widget'
import { RichTextWidget } from '@/app/_components/crm/dashboard/widgets/rich-text-widget'
import { ViewWidget } from '@/app/_components/crm/dashboard/widgets/view-widget'
import type {
  ChartConfig,
  IframeConfig,
  RichTextConfig,
  ViewConfig,
} from '@/src/schemas/crm-dashboard.schema'
import type { CrmDashboardWidgetDTO } from '@/types/crm-dashboard'

/** Renderiza o conteúdo de um widget conforme o tipo (config é Json no DTO). */
export function WidgetView({
  widget,
  workspaceId,
}: {
  widget: CrmDashboardWidgetDTO
  workspaceId: string
}) {
  switch (widget.type) {
    case 'CHART':
      return (
        <ChartWidget
          workspaceId={workspaceId}
          config={widget.config as ChartConfig}
          widgetId={widget.id}
        />
      )
    case 'VIEW':
      return (
        <ViewWidget
          workspaceId={workspaceId}
          config={widget.config as ViewConfig}
          widgetId={widget.id}
        />
      )
    case 'IFRAME':
      return <IframeWidget config={widget.config as IframeConfig} />
    case 'RICH_TEXT':
      return <RichTextWidget config={widget.config as RichTextConfig} />
    case 'SALES':
      return (
        <SalesWidget
          config={widget.config}
          workspaceId={workspaceId}
          widgetId={widget.id}
        />
      )
    default:
      return null
  }
}
