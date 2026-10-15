import type { CrmDashboardSettings } from '@/src/schemas/crm-dashboard.schema'
import type { ModuleKind } from './workspace-connection'

export interface CrmDashboardDTO {
  id: string
  title: string
  workspaceId: string
  module: ModuleKind
  createdById: string
  updatedById: string | null
  position: number
  /** Screens (pages) and TV rotation. */
  settings: CrmDashboardSettings
  createdAt: string
  updatedAt: string
}

export type CrmWidgetTypeDTO = 'CHART' | 'VIEW' | 'IFRAME' | 'RICH_TEXT' | 'SALES'

export interface CrmDashboardWidgetDTO {
  id: string
  dashboardId: string
  type: CrmWidgetTypeDTO
  x: number
  y: number
  w: number
  h: number
  /** Screen of the dashboard (0-based). */
  page: number
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** Read-only TV link of a dashboard (`/tv/<token>`). */
export interface CrmDashboardTvLinkDTO {
  id: string
  dashboardId: string
  name: string
  /** Path of the TV page, `/tv/<token>`. */
  path: string
  createdById: string
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

/**
 * Names of the ids CRM rows carry (stage, pipeline, owner), so charts and
 * tables show "Proposta enviada" and "Ana Souza" instead of cuid2 ids.
 */
export interface CrmDashboardLookupsDTO {
  pipelines: { id: string; name: string }[]
  stages: {
    id: string
    name: string
    pipelineId: string
    category: 'OPEN' | 'WON' | 'LOST'
    color: string | null
  }[]
  users: { id: string; name: string; image: string | null }[]
}

/** Everything the public TV page needs to boot (`GET /api/crm/tv/<token>`). */
export interface CrmDashboardTvBootDTO {
  workspaceName: string
  timeZone: string
  dashboard: Pick<CrmDashboardDTO, 'id' | 'title' | 'settings'>
  widgets: CrmDashboardWidgetDTO[]
  lookups: CrmDashboardLookupsDTO
}
