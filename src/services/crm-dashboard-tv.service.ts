import { randomBytes } from 'node:crypto'
import type { CrmDashboard, CrmDashboardTvLink } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { crmTvLinkNotFound, notFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toCrmDashboardTvLinkDTO,
  toCrmDashboardWidgetDTO,
} from '@/src/mappers/crm-dashboard.mapper'
import {
  CrmDashboardRepository,
  CrmDashboardTvLinkRepository,
  CrmDashboardWidgetRepository,
} from '@/src/repositories/crm-dashboard.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import {
  ChartConfigSchema,
  type CreateCrmDashboardTvLinkDTO,
  parseDashboardSettings,
  ViewConfigSchema,
  type ViewSource,
} from '@/src/schemas/crm-dashboard.schema'
import {
  SalesConfigSchema,
  type SalesMetric,
  type SalesMetricOf,
} from '@/src/schemas/crm-sales-metrics.schema'
import type {
  CrmDashboardTvBootDTO,
  CrmDashboardTvLinkDTO,
} from '@/types/crm-dashboard'
import {
  assertMember,
  assertModuleEnabled,
  assertModulePrivileged,
} from './authz'
import { CrmCompanyService } from './crm-company.service'
import { loadDashboardLookups } from './crm-dashboard.service'
import { CrmFormService } from './crm-form.service'
import { CrmLandingPageService } from './crm-landing-page.service'
import { CrmLeadService } from './crm-lead.service'
import { CrmOpportunityService } from './crm-opportunity.service'
import { CrmSalesMetricsService } from './crm-sales-metrics.service'
import { CrmTaskService } from './crm-task.service'

/** 192 random bits, URL-safe: the token is the whole credential. */
const TOKEN_BYTES = 24
/** `lastUsedAt` is refreshed at most this often (every widget hits it). */
const TOUCH_EVERY_MS = 5 * 60_000

type Row = Record<string, unknown>

/**
 * Sources a TV link may show in charts and tables. People, notes and the
 * other modules stay out: a public screen never lists contacts.
 */
const TV_ROW_SOURCES = [
  'opportunities',
  'leads',
  'tasks',
  'companies',
  'forms',
  'landing-pages',
] as const satisfies readonly ViewSource[]
type TvRowSource = (typeof TV_ROW_SOURCES)[number]

/** Contact data never leaves through a TV link (LGPD). */
const CONTACT_FIELD =
  /e-?mail|phone|linkedin|whatsapp|waid|address|document|cpf|cnpj/i

/** Drops contact fields and custom fields (free-form, may hold anything). */
export function stripContactData(rows: Row[]): Row[] {
  return rows.map((row) => {
    const clean: Row = {}
    for (const [key, value] of Object.entries(row)) {
      if (key === 'customFields' || CONTACT_FIELD.test(key)) continue
      clean[key] = value
    }
    return clean
  })
}

export type TvWidgetData =
  | { type: 'SALES'; metric: SalesMetric }
  | { type: 'ROWS'; rows: Row[] }

interface ResolvedLink {
  link: CrmDashboardTvLink
  dashboard: CrmDashboard
}

async function listRows(
  actorId: string,
  workspaceId: string,
  source: TvRowSource,
): Promise<Result<Row[]>> {
  const result = await (async (): Promise<Result<object[]>> => {
    switch (source) {
      case 'opportunities':
        return CrmOpportunityService.list(actorId, workspaceId, {})
      case 'leads':
        return CrmLeadService.list(actorId, workspaceId, {})
      case 'tasks':
        return CrmTaskService.list(actorId, workspaceId, {})
      case 'companies':
        return CrmCompanyService.list(actorId, workspaceId, { icp: undefined })
      case 'forms':
        return CrmFormService.list(actorId, workspaceId)
      case 'landing-pages':
        return CrmLandingPageService.list(actorId, workspaceId)
    }
  })()
  if (!result.ok) return result
  return ok(stripContactData(result.value as Row[]))
}

function isTvRowSource(source: string): source is TvRowSource {
  return (TV_ROW_SOURCES as readonly string[]).includes(source)
}

/** The CRM dashboard behind `dashboardId`, for the link management routes. */
async function loadCrmDashboard(
  workspaceId: string,
  dashboardId: string,
): Promise<Result<CrmDashboard>> {
  const dashboard = await CrmDashboardRepository.findById(
    dashboardId,
    workspaceId,
  )
  if (!dashboard.ok) return dashboard
  if (dashboard.value.module !== 'CRM') return err(notFound('CrmDashboard'))
  return dashboard
}

export const CrmDashboardTvService = {
  /** Live TV links of a dashboard (owners and admins of the CRM). */
  async listLinks(
    actorId: string,
    workspaceId: string,
    dashboardId: string,
  ): Promise<Result<CrmDashboardTvLinkDTO[]>> {
    const access = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!access.ok) return access
    const dashboard = await loadCrmDashboard(workspaceId, dashboardId)
    if (!dashboard.ok) return dashboard

    const links =
      await CrmDashboardTvLinkRepository.listByDashboard(dashboardId)
    if (!links.ok) return links
    return ok(links.value.map(toCrmDashboardTvLinkDTO))
  },

  /**
   * Creates a read-only TV link. Publishing CRM numbers without a login is
   * an admin decision, so only owners and admins of the CRM may do it.
   */
  async createLink(
    actorId: string,
    workspaceId: string,
    dashboardId: string,
    dto: CreateCrmDashboardTvLinkDTO,
  ): Promise<Result<CrmDashboardTvLinkDTO>> {
    const access = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!access.ok) return access
    const dashboard = await loadCrmDashboard(workspaceId, dashboardId)
    if (!dashboard.ok) return dashboard

    const created = await CrmDashboardTvLinkRepository.create({
      workspaceId,
      dashboardId,
      token: randomBytes(TOKEN_BYTES).toString('base64url'),
      name: dto.name,
      createdById: actorId,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'crm_dashboard_tv_link',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { dashboardId },
    })
    return ok(toCrmDashboardTvLinkDTO(created.value))
  },

  async revokeLink(
    actorId: string,
    workspaceId: string,
    dashboardId: string,
    linkId: string,
  ): Promise<Result<void>> {
    const access = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!access.ok) return access
    const dashboard = await loadCrmDashboard(workspaceId, dashboardId)
    if (!dashboard.ok) return dashboard

    const link = await CrmDashboardTvLinkRepository.findById(
      linkId,
      dashboardId,
    )
    if (!link.ok) return link
    const revoked = await CrmDashboardTvLinkRepository.revoke(linkId)
    if (!revoked.ok) return revoked

    auditMutation({
      entity: 'crm_dashboard_tv_link',
      action: 'delete',
      actorId,
      targetId: linkId,
      meta: { dashboardId },
    })
    return ok(undefined)
  },

  /**
   * Resolves a token to its live link and CRM dashboard. Any broken link in
   * the chain (revoked, dashboard deleted, CRM off, creator no longer able
   * to see dashboards) answers the same not-found error.
   */
  async resolve(
    token: string,
    now: Date = new Date(),
  ): Promise<Result<ResolvedLink>> {
    if (!token || token.length > 128) return err(crmTvLinkNotFound())
    const found = await CrmDashboardTvLinkRepository.findByToken(token)
    if (!found.ok) return found
    const { dashboard, ...link } = found.value
    if (dashboard.deletedAt || dashboard.module !== 'CRM') {
      return err(crmTvLinkNotFound())
    }

    const enabled = await assertModuleEnabled(link.workspaceId, 'CRM')
    if (!enabled.ok)
      return enabled.error.code === 'DATABASE_ERROR'
        ? enabled
        : err(crmTvLinkNotFound())
    const creator = await assertMember(link.createdById, link.workspaceId, {
      resource: 'dashboards',
      action: 'VIEW',
    })
    if (!creator.ok) {
      return creator.error.code === 'DATABASE_ERROR'
        ? creator
        : err(crmTvLinkNotFound())
    }

    if (
      !link.lastUsedAt ||
      now.getTime() - link.lastUsedAt.getTime() > TOUCH_EVERY_MS
    ) {
      const touched = await CrmDashboardTvLinkRepository.touch(link.id, now)
      if (!touched.ok) {
        logger.warn('crm_dashboard_tv.touch_failed', { linkId: link.id })
      }
    }
    return ok({ link, dashboard })
  },

  /** What the TV page needs to boot: dashboard, screens, widgets, names. */
  async boot(token: string): Promise<Result<CrmDashboardTvBootDTO>> {
    const resolved = await CrmDashboardTvService.resolve(token)
    if (!resolved.ok) return resolved
    const { link, dashboard } = resolved.value

    const [widgets, lookups, workspace, clock] = await Promise.all([
      CrmDashboardWidgetRepository.listByDashboard(dashboard.id),
      loadDashboardLookups(link.workspaceId),
      WorkspaceRepository.findById(link.workspaceId),
      CrmSalesMetricsService.clock(link.workspaceId),
    ])
    if (!widgets.ok) return widgets
    if (!lookups.ok) return lookups
    if (!workspace.ok) return workspace
    if (!clock.ok) return clock

    return ok({
      workspaceName: workspace.value.name,
      timeZone: clock.value.timeZone,
      dashboard: {
        id: dashboard.id,
        title: dashboard.title,
        settings: parseDashboardSettings(dashboard.settings),
      },
      widgets: widgets.value
        // An iframe could frame anything; the TV link shows CRM data only.
        .filter((widget) => widget.type !== 'IFRAME')
        .map(toCrmDashboardWidgetDTO),
      lookups: lookups.value,
    })
  },

  /**
   * Data of one widget of the linked dashboard: the metric of a "Vendas"
   * widget, or the (contact-free) rows of a chart/table source.
   */
  async widgetData(
    token: string,
    widgetId: string,
    now: Date = new Date(),
  ): Promise<Result<TvWidgetData>> {
    const resolved = await CrmDashboardTvService.resolve(token, now)
    if (!resolved.ok) return resolved
    const { link, dashboard } = resolved.value

    const widget = await CrmDashboardWidgetRepository.findById(
      widgetId,
      dashboard.id,
    )
    if (!widget.ok) return widget

    if (widget.value.type === 'SALES') {
      const config = SalesConfigSchema.safeParse(widget.value.config)
      if (!config.success) return err(notFound('CrmDashboardWidget'))
      const metric = await CrmSalesMetricsService.compute(
        link.workspaceId,
        config.data,
        now,
      )
      if (!metric.ok) return metric
      return ok({ type: 'SALES', metric: metric.value })
    }

    const parsed =
      widget.value.type === 'CHART'
        ? ChartConfigSchema.safeParse(widget.value.config)
        : widget.value.type === 'VIEW'
          ? ViewConfigSchema.safeParse(widget.value.config)
          : null
    if (!parsed?.success || !isTvRowSource(parsed.data.source)) {
      return ok({ type: 'ROWS', rows: [] })
    }
    const rows = await listRows(
      link.createdById,
      link.workspaceId,
      parsed.data.source,
    )
    if (!rows.ok) return rows
    return ok({ type: 'ROWS', rows: rows.value })
  },

  /** Latest wins, polled by the TV to celebrate a new one. */
  async wins(
    token: string,
    now: Date = new Date(),
  ): Promise<Result<SalesMetricOf<'wins-feed'>>> {
    const resolved = await CrmDashboardTvService.resolve(token, now)
    if (!resolved.ok) return resolved
    const feed = await CrmSalesMetricsService.compute(
      resolved.value.link.workspaceId,
      { kind: 'wins-feed', period: 'month', stalledDays: 14, limit: 5 },
      now,
    )
    if (!feed.ok) return feed
    return ok(feed.value as SalesMetricOf<'wins-feed'>)
  },
}
