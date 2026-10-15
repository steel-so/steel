import { WIDGET_TYPE_META } from '@/app/_components/crm/dashboard/widget-meta'
import type { CrmDashboardWidgetDTO } from '@/types/crm-dashboard'

function typeLabel(type: CrmDashboardWidgetDTO['type']): string {
  return WIDGET_TYPE_META.find((meta) => meta.type === type)?.label ?? type
}

/** Título do widget (config.title) ou, na falta, o nome do tipo. */
export function widgetTitle(widget: CrmDashboardWidgetDTO): string {
  const title = (widget.config as { title?: unknown }).title
  return typeof title === 'string' && title.trim()
    ? title.trim()
    : typeLabel(widget.type)
}

/**
 * Tela de um widget: widgets de uma tela que deixou de existir aparecem na
 * última (nada some do painel).
 */
export function pageOfWidget(
  widget: Pick<CrmDashboardWidgetDTO, 'page'>,
  pageCount: number,
): number {
  return Math.min(Math.max(0, widget.page ?? 0), Math.max(0, pageCount - 1))
}
