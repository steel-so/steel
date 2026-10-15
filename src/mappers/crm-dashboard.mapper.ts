import type {
  CrmDashboard,
  CrmDashboardTvLink,
  CrmDashboardWidget,
} from '@prisma/client'
import { parseDashboardSettings } from '@/src/schemas/crm-dashboard.schema'
import type {
  CrmDashboardDTO,
  CrmDashboardTvLinkDTO,
  CrmDashboardWidgetDTO,
} from '@/types/crm-dashboard'

export function toCrmDashboardDTO(dashboard: CrmDashboard): CrmDashboardDTO {
  return {
    id: dashboard.id,
    title: dashboard.title,
    workspaceId: dashboard.workspaceId,
    module: dashboard.module,
    createdById: dashboard.createdById,
    updatedById: dashboard.updatedById,
    position: dashboard.position,
    settings: parseDashboardSettings(dashboard.settings),
    createdAt: dashboard.createdAt.toISOString(),
    updatedAt: dashboard.updatedAt.toISOString(),
  }
}

export function toCrmDashboardWidgetDTO(
  widget: CrmDashboardWidget,
): CrmDashboardWidgetDTO {
  return {
    id: widget.id,
    dashboardId: widget.dashboardId,
    type: widget.type,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
    page: widget.page,
    config: widget.config as Record<string, unknown>,
    createdAt: widget.createdAt.toISOString(),
    updatedAt: widget.updatedAt.toISOString(),
  }
}

export function toCrmDashboardTvLinkDTO(
  link: CrmDashboardTvLink,
): CrmDashboardTvLinkDTO {
  return {
    id: link.id,
    dashboardId: link.dashboardId,
    name: link.name,
    path: `/tv/${link.token}`,
    createdById: link.createdById,
    lastUsedAt: link.lastUsedAt?.toISOString() ?? null,
    revokedAt: link.revokedAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString(),
  }
}
