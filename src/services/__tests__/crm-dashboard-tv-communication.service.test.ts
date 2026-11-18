import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmDashboard,
  createFakeCrmDashboardWidget,
} from '@/src/__tests__/factories/crm-dashboard.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { crmTvLinkNotFound, databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-dashboard.repository')
vi.mock('@/src/repositories/crm-sales-metrics.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/services/crm-sales-metrics.service', () => ({
  CrmSalesMetricsService: { compute: vi.fn(), clock: vi.fn() },
}))
vi.mock('@/src/services/crm-opportunity.service', () => ({
  CrmOpportunityService: { list: vi.fn() },
}))
vi.mock('@/src/services/crm-lead.service', () => ({
  CrmLeadService: { list: vi.fn() },
}))
vi.mock('@/src/services/crm-task.service', () => ({
  CrmTaskService: { list: vi.fn() },
}))
vi.mock('@/src/services/crm-company.service', () => ({
  CrmCompanyService: { list: vi.fn() },
}))
vi.mock('@/src/services/crm-form.service', () => ({
  CrmFormService: { list: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-dashboard-source.service', () => ({
  WhatsAppDashboardSourceService: { rowsForWorkspace: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import {
  CrmDashboardRepository,
  CrmDashboardTvLinkRepository,
  CrmDashboardWidgetRepository,
} from '@/src/repositories/crm-dashboard.repository'
import { CrmSalesMetricsRepository } from '@/src/repositories/crm-sales-metrics.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmOpportunityService } from '@/src/services/crm-opportunity.service'
import { CrmSalesMetricsService } from '@/src/services/crm-sales-metrics.service'
import { WhatsAppDashboardSourceService } from '@/src/services/whatsapp-dashboard-source.service'
import { CrmDashboardTvService } from '../crm-dashboard-tv.service'

const memberships = vi.mocked(MembershipRepository)
const dashboards = vi.mocked(CrmDashboardRepository)
const links = vi.mocked(CrmDashboardTvLinkRepository)
const widgets = vi.mocked(CrmDashboardWidgetRepository)
const salesRepo = vi.mocked(CrmSalesMetricsRepository)
const workspaces = vi.mocked(WorkspaceRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const metrics = vi.mocked(CrmSalesMetricsService)
const audit = vi.mocked(auditMutation)
const waRows = vi.mocked(WhatsAppDashboardSourceService.rowsForWorkspace)

const NOW = new Date('2026-11-18T15:00:00.000Z')

function asRole(role: Role) {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const dashboardOf = (module: 'CRM' | 'COMMUNICATION', overrides = {}) =>
  createFakeCrmDashboard({
    id: 'd1',
    workspaceId: 'ws1',
    module,
    title: 'PERFORMANCE WHATSAPP IA',
    ...overrides,
  })

function link(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    workspaceId: 'ws1',
    dashboardId: 'd1',
    token: 'tok',
    name: 'TV',
    createdById: 'creator',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: NOW,
    ...overrides,
  }
}

function useLinkOn(module: 'CRM' | 'COMMUNICATION') {
  links.findByToken.mockResolvedValue(
    ok({ ...link(), dashboard: dashboardOf(module) }),
  )
}

const viewWidget = (source: string) =>
  createFakeCrmDashboardWidget({ type: 'VIEW', config: { source } })

beforeEach(() => {
  useLinkOn('COMMUNICATION')
  links.touch.mockResolvedValue(ok(undefined))
  asRole('MEMBER')
})

describe('link management for Comunicação dashboards', () => {
  it('creates a link as an admin of the module and audits the module', async () => {
    asRole('ADMIN')
    dashboards.findById.mockResolvedValue(ok(dashboardOf('COMMUNICATION')))
    links.create.mockImplementation(async (data) => ok(link(data)))
    const created = expectOk(
      await CrmDashboardTvService.createLink(
        'u1',
        'ws1',
        'd1',
        { name: 'Sala' },
        'COMMUNICATION',
      ),
    )
    expect(created.path).toMatch(/^\/tv\//)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: { dashboardId: 'd1', module: 'COMMUNICATION' },
      }),
    )
  })

  it('requires an owner or admin', async () => {
    expectErr(
      await CrmDashboardTvService.createLink(
        'u1',
        'ws1',
        'd1',
        { name: 'x' },
        'COMMUNICATION',
      ),
      'FORBIDDEN',
    )
    expect(links.create).not.toHaveBeenCalled()
  })

  it('refuses when the Comunicação module is off', async () => {
    asRole('ADMIN')
    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(
      await CrmDashboardTvService.listLinks('u1', 'ws1', 'd1', 'COMMUNICATION'),
      'MODULE_DISABLED',
    )
  })

  it('keeps the modules apart in both directions', async () => {
    asRole('ADMIN')
    dashboards.findById.mockResolvedValue(ok(dashboardOf('COMMUNICATION')))
    expectErr(
      await CrmDashboardTvService.createLink('u1', 'ws1', 'd1', { name: 'x' }),
      'RESOURCE_NOT_FOUND',
    )

    dashboards.findById.mockResolvedValue(ok(dashboardOf('CRM')))
    expectErr(
      await CrmDashboardTvService.listLinks('u1', 'ws1', 'd1', 'COMMUNICATION'),
      'RESOURCE_NOT_FOUND',
    )
    expectErr(
      await CrmDashboardTvService.revokeLink(
        'u1',
        'ws1',
        'd1',
        'l1',
        'COMMUNICATION',
      ),
      'RESOURCE_NOT_FOUND',
    )
    expect(links.create).not.toHaveBeenCalled()
    expect(links.revoke).not.toHaveBeenCalled()
  })

  it('revokes a link of a Comunicação dashboard', async () => {
    asRole('OWNER')
    dashboards.findById.mockResolvedValue(ok(dashboardOf('COMMUNICATION')))
    links.findById.mockResolvedValue(ok(link()))
    links.revoke.mockResolvedValue(ok(undefined))
    expectOk(
      await CrmDashboardTvService.revokeLink(
        'u1',
        'ws1',
        'd1',
        'l1',
        'COMMUNICATION',
      ),
    )
    expect(links.revoke).toHaveBeenCalledWith('l1')
  })
})

describe('resolve() for Comunicação links', () => {
  it('resolves a live link', async () => {
    const resolved = expectOk(await CrmDashboardTvService.resolve('tok'))
    expect(resolved.dashboard.module).toBe('COMMUNICATION')
  })

  it('refuses a link whose dashboard module is disabled', async () => {
    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(
      await CrmDashboardTvService.resolve('tok'),
      'CRM_TV_LINK_NOT_FOUND',
    )
  })

  it('answers the same error for a revoked or expired link', async () => {
    links.findByToken.mockResolvedValue(err(crmTvLinkNotFound()))
    expectErr(
      await CrmDashboardTvService.resolve('tok'),
      'CRM_TV_LINK_NOT_FOUND',
    )
  })
})

describe('boot() for Comunicação links', () => {
  it('boots without CRM lookups', async () => {
    widgets.listByDashboard.mockResolvedValue(
      ok([createFakeCrmDashboardWidget({ id: 'w1', type: 'VIEW' })]),
    )
    workspaces.findById.mockResolvedValue(
      ok(createFakeWorkspace({ id: 'ws1', name: 'Fidelizza' })),
    )
    metrics.clock.mockResolvedValue(
      ok({ timeZone: 'America/Sao_Paulo', holidays: new Set<string>() }),
    )
    const boot = expectOk(await CrmDashboardTvService.boot('tok'))
    expect(boot.module).toBe('COMMUNICATION')
    expect(boot.lookups).toEqual({ pipelines: [], stages: [], users: [] })
    expect(salesRepo.listMembers).not.toHaveBeenCalled()
  })
})

describe('widgetData() for Comunicação links', () => {
  it('serves allowlisted rows through the workspace loader, not a user gate', async () => {
    waRows.mockResolvedValue(
      ok([
        { id: 'c1', hasWhatsapp: 'Sim', isBlocked: false, contactName: 'Ana' },
      ]) as never,
    )
    widgets.findById.mockResolvedValue(ok(viewWidget('whatsapp-contacts')))
    expect(
      expectOk(await CrmDashboardTvService.widgetData('tok', 'w1', NOW)),
    ).toEqual({
      type: 'ROWS',
      rows: [{ id: 'c1', hasWhatsapp: 'Sim', isBlocked: false }],
    })
    expect(waRows).toHaveBeenCalledWith('ws1', 'whatsapp-contacts', NOW)
  })

  it('drops the free text typed by attendants', async () => {
    waRows.mockResolvedValue(
      ok([
        { id: 'a1', team: 'Bancos', closeReason: 'Falou com a Maria' },
      ]) as never,
    )
    widgets.findById.mockResolvedValue(
      ok(
        createFakeCrmDashboardWidget({
          type: 'CHART',
          config: { chartType: 'pie', source: 'whatsapp-attendances' },
        }),
      ),
    )
    expect(
      expectOk(await CrmDashboardTvService.widgetData('tok', 'w1')),
    ).toEqual({ type: 'ROWS', rows: [{ id: 'a1', team: 'Bancos' }] })
  })

  it('serves nothing for CRM sources and the old WhatsApp sources', async () => {
    for (const source of [
      'opportunities',
      'people',
      'whatsapp-conversations',
      'whatsapp-broadcasts',
    ]) {
      widgets.findById.mockResolvedValue(ok(viewWidget(source)))
      expect(
        expectOk(await CrmDashboardTvService.widgetData('tok', 'w1')),
      ).toEqual({ type: 'ROWS', rows: [] })
    }
    expect(waRows).not.toHaveBeenCalled()
    expect(CrmOpportunityService.list).not.toHaveBeenCalled()
  })

  it('refuses the CRM sales kit', async () => {
    widgets.findById.mockResolvedValue(
      ok(
        createFakeCrmDashboardWidget({
          type: 'SALES',
          config: { kind: 'ranking' },
        }),
      ),
    )
    expectErr(
      await CrmDashboardTvService.widgetData('tok', 'w1'),
      'RESOURCE_NOT_FOUND',
    )
    expect(metrics.compute).not.toHaveBeenCalled()
  })

  it('reads only widgets of the link dashboard and propagates errors', async () => {
    widgets.findById.mockResolvedValue(err(notFound('CrmDashboardWidget')))
    expectErr(
      await CrmDashboardTvService.widgetData('tok', 'other'),
      'RESOURCE_NOT_FOUND',
    )
    expect(widgets.findById).toHaveBeenCalledWith('other', 'd1')

    widgets.findById.mockResolvedValue(ok(viewWidget('whatsapp-calls')))
    waRows.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDashboardTvService.widgetData('tok', 'w1'),
      'DATABASE_ERROR',
    )
  })

  it('never lets a CRM link read WhatsApp sources', async () => {
    useLinkOn('CRM')
    widgets.findById.mockResolvedValue(ok(viewWidget('whatsapp-calls')))
    expect(
      expectOk(await CrmDashboardTvService.widgetData('tok', 'w1')),
    ).toEqual({ type: 'ROWS', rows: [] })
    expect(waRows).not.toHaveBeenCalled()
  })
})

describe('wins() for Comunicação links', () => {
  it('answers an empty feed without touching CRM data', async () => {
    expect(expectOk(await CrmDashboardTvService.wins('tok', NOW))).toEqual({
      kind: 'wins-feed',
      rows: [],
    })
    expect(metrics.compute).not.toHaveBeenCalled()
  })
})
