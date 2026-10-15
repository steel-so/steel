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
vi.mock('@/src/services/crm-landing-page.service', () => ({
  CrmLandingPageService: { list: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  CrmDashboardRepository,
  CrmDashboardTvLinkRepository,
  CrmDashboardWidgetRepository,
} from '@/src/repositories/crm-dashboard.repository'
import { CrmSalesMetricsRepository } from '@/src/repositories/crm-sales-metrics.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmCompanyService } from '@/src/services/crm-company.service'
import { CrmFormService } from '@/src/services/crm-form.service'
import { CrmLandingPageService } from '@/src/services/crm-landing-page.service'
import { CrmLeadService } from '@/src/services/crm-lead.service'
import { CrmOpportunityService } from '@/src/services/crm-opportunity.service'
import { CrmSalesMetricsService } from '@/src/services/crm-sales-metrics.service'
import { CrmTaskService } from '@/src/services/crm-task.service'
import {
  CrmDashboardTvService,
  stripContactData,
} from '../crm-dashboard-tv.service'

const memberships = vi.mocked(MembershipRepository)
const dashboards = vi.mocked(CrmDashboardRepository)
const links = vi.mocked(CrmDashboardTvLinkRepository)
const widgets = vi.mocked(CrmDashboardWidgetRepository)
const salesRepo = vi.mocked(CrmSalesMetricsRepository)
const workspaces = vi.mocked(WorkspaceRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const metrics = vi.mocked(CrmSalesMetricsService)
const audit = vi.mocked(auditMutation)

const NOW = new Date('2026-10-15T15:00:00.000Z')

function asRole(role: Role) {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const crmDashboard = (overrides = {}) =>
  createFakeCrmDashboard({
    id: 'd1',
    workspaceId: 'ws1',
    module: 'CRM',
    title: 'Vendas — TV',
    settings: { pages: ['Metas', 'Pipeline'], rotateSeconds: 30 },
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

function linkWithDashboard(
  overrides: Record<string, unknown> = {},
  dashboard = crmDashboard(),
) {
  return { ...link(overrides), dashboard }
}

beforeEach(() => {
  links.findByToken.mockResolvedValue(ok(linkWithDashboard()))
  links.touch.mockResolvedValue(ok(undefined))
  asRole('MEMBER')
})

describe('stripContactData()', () => {
  it('drops contact and custom fields', () => {
    expect(
      stripContactData([
        {
          id: '1',
          name: 'Lead',
          emails: ['a@b.c'],
          phones: ['11'],
          email: 'x',
          linkedin: 'in/x',
          contactWaId: '55',
          addressLine: 'Rua',
          cnpj: '00',
          customFields: { cpf: '1' },
          stageId: 's1',
        },
      ]),
    ).toEqual([{ id: '1', name: 'Lead', stageId: 's1' }])
  })
})

describe('link management', () => {
  it('requires an owner or admin of the CRM', async () => {
    asRole('MEMBER')
    expectErr(
      await CrmDashboardTvService.listLinks('u1', 'ws1', 'd1'),
      'FORBIDDEN',
    )
    expectErr(
      await CrmDashboardTvService.createLink('u1', 'ws1', 'd1', { name: 'TV' }),
      'FORBIDDEN',
    )
    expectErr(
      await CrmDashboardTvService.revokeLink('u1', 'ws1', 'd1', 'l1'),
      'FORBIDDEN',
    )
    expect(links.create).not.toHaveBeenCalled()
  })

  it('refuses dashboards of other modules', async () => {
    asRole('ADMIN')
    dashboards.findById.mockResolvedValue(
      ok(crmDashboard({ module: 'SERVICE_DESK' })),
    )
    expectErr(
      await CrmDashboardTvService.listLinks('u1', 'ws1', 'd1'),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('propagates a missing dashboard', async () => {
    asRole('ADMIN')
    dashboards.findById.mockResolvedValue(err(notFound('CrmDashboard')))
    expectErr(
      await CrmDashboardTvService.createLink('u1', 'ws1', 'd1', { name: 'TV' }),
      'RESOURCE_NOT_FOUND',
    )
    expectErr(
      await CrmDashboardTvService.revokeLink('u1', 'ws1', 'd1', 'l1'),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('lists live links with their TV path', async () => {
    asRole('OWNER')
    dashboards.findById.mockResolvedValue(ok(crmDashboard()))
    links.listByDashboard.mockResolvedValue(ok([link()]))
    const list = expectOk(
      await CrmDashboardTvService.listLinks('u1', 'ws1', 'd1'),
    )
    expect(list).toEqual([
      expect.objectContaining({ id: 'l1', path: '/tv/tok' }),
    ])

    links.listByDashboard.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDashboardTvService.listLinks('u1', 'ws1', 'd1'),
      'DATABASE_ERROR',
    )
  })

  it('creates a link with a long random token and audits it', async () => {
    asRole('ADMIN')
    dashboards.findById.mockResolvedValue(ok(crmDashboard()))
    links.create.mockImplementation(async (data) => ok(link(data)))
    const created = expectOk(
      await CrmDashboardTvService.createLink('u1', 'ws1', 'd1', {
        name: 'Sala',
      }),
    )
    const data = links.create.mock.calls[0][0]
    expect(data).toMatchObject({
      workspaceId: 'ws1',
      dashboardId: 'd1',
      name: 'Sala',
      createdById: 'u1',
    })
    expect(data.token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(created.path).toBe(`/tv/${data.token}`)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_dashboard_tv_link',
        action: 'create',
      }),
    )

    links.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDashboardTvService.createLink('u1', 'ws1', 'd1', {
        name: 'Sala',
      }),
      'DATABASE_ERROR',
    )
  })

  it('revokes a live link of the dashboard', async () => {
    asRole('ADMIN')
    dashboards.findById.mockResolvedValue(ok(crmDashboard()))
    links.findById.mockResolvedValue(ok(link()))
    links.revoke.mockResolvedValue(ok(undefined))
    expectOk(await CrmDashboardTvService.revokeLink('u1', 'ws1', 'd1', 'l1'))
    expect(links.findById).toHaveBeenCalledWith('l1', 'd1')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_dashboard_tv_link',
        action: 'delete',
        targetId: 'l1',
      }),
    )

    links.revoke.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDashboardTvService.revokeLink('u1', 'ws1', 'd1', 'l1'),
      'DATABASE_ERROR',
    )

    links.findById.mockResolvedValue(err(crmTvLinkNotFound()))
    expectErr(
      await CrmDashboardTvService.revokeLink('u1', 'ws1', 'd1', 'l1'),
      'CRM_TV_LINK_NOT_FOUND',
    )
  })
})

describe('resolve()', () => {
  it('rejects empty and oversized tokens without a query', async () => {
    expectErr(await CrmDashboardTvService.resolve(''), 'CRM_TV_LINK_NOT_FOUND')
    expectErr(
      await CrmDashboardTvService.resolve('x'.repeat(200)),
      'CRM_TV_LINK_NOT_FOUND',
    )
    expect(links.findByToken).not.toHaveBeenCalled()
  })

  it('answers not found for a revoked or unknown token', async () => {
    links.findByToken.mockResolvedValue(err(crmTvLinkNotFound()))
    expectErr(
      await CrmDashboardTvService.resolve('tok'),
      'CRM_TV_LINK_NOT_FOUND',
    )
  })

  it('answers not found for a deleted or non-CRM dashboard', async () => {
    links.findByToken.mockResolvedValue(
      ok(linkWithDashboard({}, crmDashboard({ deletedAt: NOW }))),
    )
    expectErr(
      await CrmDashboardTvService.resolve('tok'),
      'CRM_TV_LINK_NOT_FOUND',
    )
    links.findByToken.mockResolvedValue(
      ok(linkWithDashboard({}, crmDashboard({ module: 'COMMUNICATION' }))),
    )
    expectErr(
      await CrmDashboardTvService.resolve('tok'),
      'CRM_TV_LINK_NOT_FOUND',
    )
  })

  it('answers not found when the CRM is off', async () => {
    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(
      await CrmDashboardTvService.resolve('tok'),
      'CRM_TV_LINK_NOT_FOUND',
    )
    moduleAccess.isEnabled.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrmDashboardTvService.resolve('tok'), 'DATABASE_ERROR')
  })

  it('dies with its creator leaving the workspace', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await CrmDashboardTvService.resolve('tok'),
      'CRM_TV_LINK_NOT_FOUND',
    )
    memberships.findByUserAndWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await CrmDashboardTvService.resolve('tok'), 'DATABASE_ERROR')
  })

  it('touches lastUsedAt at most every 5 minutes', async () => {
    expectOk(await CrmDashboardTvService.resolve('tok', NOW))
    expect(links.touch).toHaveBeenCalledWith('l1', NOW)

    links.touch.mockClear()
    links.findByToken.mockResolvedValue(
      ok(linkWithDashboard({ lastUsedAt: new Date(NOW.getTime() - 60_000) })),
    )
    expectOk(await CrmDashboardTvService.resolve('tok', NOW))
    expect(links.touch).not.toHaveBeenCalled()
  })

  it('still resolves when touching fails', async () => {
    links.touch.mockResolvedValue(err(databaseError()))
    expectOk(await CrmDashboardTvService.resolve('tok', NOW))
    expect(logger.warn).toHaveBeenCalledWith('crm_dashboard_tv.touch_failed', {
      linkId: 'l1',
    })
  })
})

describe('boot()', () => {
  beforeEach(() => {
    widgets.listByDashboard.mockResolvedValue(
      ok([
        createFakeCrmDashboardWidget({ id: 'w-sales', type: 'SALES', page: 1 }),
        createFakeCrmDashboardWidget({ id: 'w-frame', type: 'IFRAME' }),
      ]),
    )
    salesRepo.listPipelines.mockResolvedValue(
      ok([{ id: 'p1', name: 'Vendas' }]),
    )
    salesRepo.listStages.mockResolvedValue(
      ok([
        {
          id: 's1',
          name: 'Proposta',
          pipelineId: 'p1',
          position: 0,
          probability: 50,
          color: '#fff',
          category: 'OPEN',
        },
      ]),
    )
    salesRepo.listMembers.mockResolvedValue(
      ok([{ id: 'u1', name: 'Ana', image: null }]),
    )
    workspaces.findById.mockResolvedValue(
      ok(createFakeWorkspace({ id: 'ws1', name: 'Stratus' })),
    )
    metrics.clock.mockResolvedValue(
      ok({ timeZone: 'America/Sao_Paulo', holidays: new Set<string>() }),
    )
  })

  it('returns the dashboard, screens, widgets without iframes and names', async () => {
    const boot = expectOk(await CrmDashboardTvService.boot('tok'))
    expect(boot.workspaceName).toBe('Stratus')
    expect(boot.timeZone).toBe('America/Sao_Paulo')
    expect(boot.dashboard).toEqual({
      id: 'd1',
      title: 'Vendas — TV',
      settings: { pages: ['Metas', 'Pipeline'], rotateSeconds: 30 },
    })
    expect(boot.widgets.map((w) => [w.id, w.page])).toEqual([['w-sales', 1]])
    expect(boot.lookups.stages[0]).toEqual({
      id: 's1',
      name: 'Proposta',
      pipelineId: 'p1',
      category: 'OPEN',
      color: '#fff',
    })
  })

  it('propagates resolution and database errors', async () => {
    links.findByToken.mockResolvedValueOnce(err(crmTvLinkNotFound()))
    expectErr(await CrmDashboardTvService.boot('tok'), 'CRM_TV_LINK_NOT_FOUND')

    metrics.clock.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrmDashboardTvService.boot('tok'), 'DATABASE_ERROR')
    workspaces.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrmDashboardTvService.boot('tok'), 'DATABASE_ERROR')
    salesRepo.listMembers.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrmDashboardTvService.boot('tok'), 'DATABASE_ERROR')
    salesRepo.listStages.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrmDashboardTvService.boot('tok'), 'DATABASE_ERROR')
    salesRepo.listPipelines.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrmDashboardTvService.boot('tok'), 'DATABASE_ERROR')
    widgets.listByDashboard.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrmDashboardTvService.boot('tok'), 'DATABASE_ERROR')
  })
})

describe('widgetData()', () => {
  it('computes a sales metric from the stored config', async () => {
    widgets.findById.mockResolvedValue(
      ok(
        createFakeCrmDashboardWidget({
          type: 'SALES',
          config: { kind: 'ranking', limit: 3 },
        }),
      ),
    )
    metrics.compute.mockResolvedValue(ok({ kind: 'wins-feed', rows: [] }))
    const data = expectOk(
      await CrmDashboardTvService.widgetData('tok', 'w1', NOW),
    )
    expect(data).toEqual({
      type: 'SALES',
      metric: { kind: 'wins-feed', rows: [] },
    })
    expect(metrics.compute).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ kind: 'ranking', limit: 3, period: 'month' }),
      NOW,
    )
    expect(widgets.findById).toHaveBeenCalledWith('w1', 'd1')

    metrics.compute.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDashboardTvService.widgetData('tok', 'w1', NOW),
      'DATABASE_ERROR',
    )
  })

  it('refuses a broken sales config', async () => {
    widgets.findById.mockResolvedValue(
      ok(
        createFakeCrmDashboardWidget({
          type: 'SALES',
          config: { kind: 'nope' },
        }),
      ),
    )
    expectErr(
      await CrmDashboardTvService.widgetData('tok', 'w1'),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('serves contact-free rows of each allowed source as the link creator', async () => {
    const cases = [
      ['opportunities', CrmOpportunityService.list],
      ['leads', CrmLeadService.list],
      ['tasks', CrmTaskService.list],
      ['companies', CrmCompanyService.list],
      ['forms', CrmFormService.list],
      ['landing-pages', CrmLandingPageService.list],
    ] as const
    for (const [source, list] of cases) {
      vi.mocked(list).mockResolvedValue(
        ok([{ id: 'r1', name: 'Registro', emails: ['x@y.z'] }]) as never,
      )
      widgets.findById.mockResolvedValue(
        ok(
          createFakeCrmDashboardWidget({
            type: 'VIEW',
            config: { source },
          }),
        ),
      )
      const data = expectOk(await CrmDashboardTvService.widgetData('tok', 'w1'))
      expect(data).toEqual({
        type: 'ROWS',
        rows: [{ id: 'r1', name: 'Registro' }],
      })
      expect(vi.mocked(list).mock.calls[0][0]).toBe('creator')
    }
  })

  it('reads chart sources and propagates their errors', async () => {
    vi.mocked(CrmOpportunityService.list).mockResolvedValue(
      err(databaseError()),
    )
    widgets.findById.mockResolvedValue(
      ok(
        createFakeCrmDashboardWidget({
          type: 'CHART',
          config: { chartType: 'vertical', source: 'opportunities' },
        }),
      ),
    )
    expectErr(
      await CrmDashboardTvService.widgetData('tok', 'w1'),
      'DATABASE_ERROR',
    )
  })

  it('serves nothing for people, other modules, text and broken configs', async () => {
    for (const widget of [
      createFakeCrmDashboardWidget({
        type: 'VIEW',
        config: { source: 'people' },
      }),
      createFakeCrmDashboardWidget({
        type: 'CHART',
        config: { chartType: 'pie', source: 'whatsapp-conversations' },
      }),
      createFakeCrmDashboardWidget({
        type: 'RICH_TEXT',
        config: { html: '<p>x</p>' },
      }),
      createFakeCrmDashboardWidget({ type: 'VIEW', config: { source: 42 } }),
    ]) {
      widgets.findById.mockResolvedValue(ok(widget))
      expect(
        expectOk(await CrmDashboardTvService.widgetData('tok', 'w1')),
      ).toEqual({
        type: 'ROWS',
        rows: [],
      })
    }
  })

  it('propagates resolution and widget errors', async () => {
    widgets.findById.mockResolvedValue(err(notFound('CrmDashboardWidget')))
    expectErr(
      await CrmDashboardTvService.widgetData('tok', 'w9'),
      'RESOURCE_NOT_FOUND',
    )
    links.findByToken.mockResolvedValue(err(crmTvLinkNotFound()))
    expectErr(
      await CrmDashboardTvService.widgetData('tok', 'w1'),
      'CRM_TV_LINK_NOT_FOUND',
    )
  })
})

describe('wins()', () => {
  it('returns the 5 latest wins', async () => {
    metrics.compute.mockResolvedValue(ok({ kind: 'wins-feed', rows: [] }))
    expect(expectOk(await CrmDashboardTvService.wins('tok', NOW))).toEqual({
      kind: 'wins-feed',
      rows: [],
    })
    expect(metrics.compute).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ kind: 'wins-feed', limit: 5 }),
      NOW,
    )
  })

  it('propagates errors', async () => {
    metrics.compute.mockResolvedValue(err(databaseError()))
    expectErr(await CrmDashboardTvService.wins('tok'), 'DATABASE_ERROR')
    links.findByToken.mockResolvedValue(err(crmTvLinkNotFound()))
    expectErr(await CrmDashboardTvService.wins('tok'), 'CRM_TV_LINK_NOT_FOUND')
  })
})
