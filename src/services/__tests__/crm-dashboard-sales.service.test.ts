import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmDashboard,
  createFakeCrmDashboardWidget,
} from '@/src/__tests__/factories/crm-dashboard.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-dashboard.repository')
vi.mock('@/src/repositories/crm-sales-metrics.repository')
vi.mock('@/src/repositories/sd-access.repository')

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { actAs } from '@/src/__tests__/helpers/sd-access.helpers'
import {
  CrmDashboardRepository,
  CrmDashboardWidgetRepository,
} from '@/src/repositories/crm-dashboard.repository'
import { CrmSalesMetricsRepository } from '@/src/repositories/crm-sales-metrics.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SalesConfigSchema } from '@/src/schemas/crm-sales-metrics.schema'
import {
  CrmDashboardService,
  CrmDashboardWidgetService,
} from '../crm-dashboard.service'
import { DASHBOARD_TEMPLATE_DATA } from '../crm-dashboard-templates'

const memberships = vi.mocked(MembershipRepository)
const dashboards = vi.mocked(CrmDashboardRepository)
const widgets = vi.mocked(CrmDashboardWidgetRepository)
const salesRepo = vi.mocked(CrmSalesMetricsRepository)
const audit = vi.mocked(auditMutation)

function asRole(role: Role) {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => asRole('MEMBER'))

describe('"Vendas — TV" template', () => {
  const template = DASHBOARD_TEMPLATE_DATA['sales-tv']

  it('has valid sales configs on two screens of at most 8 blocks', () => {
    expect(template.settings.pages).toHaveLength(2)
    for (const widget of template.widgets) {
      expect(widget.type).toBe('SALES')
      expect(SalesConfigSchema.safeParse(widget.config).success).toBe(true)
      expect(widget.page).toBeLessThan(template.settings.pages.length)
    }
    for (const page of [0, 1]) {
      const onPage = template.widgets.filter((w) => w.page === page)
      expect(onPage.length).toBeGreaterThan(0)
      expect(onPage.length).toBeLessThanOrEqual(8)
    }
  })

  it('lays the blocks inside 12 columns without overlaps', () => {
    for (const page of [0, 1]) {
      const cells = new Set<string>()
      for (const widget of template.widgets.filter((w) => w.page === page)) {
        expect(widget.x + widget.w).toBeLessThanOrEqual(12)
        for (let x = widget.x; x < widget.x + widget.w; x++) {
          for (let y = widget.y; y < widget.y + widget.h; y++) {
            const cell = `${x}:${y}`
            expect(cells.has(cell)).toBe(false)
            cells.add(cell)
          }
        }
      }
    }
  })

  it('covers every metric of the kit', () => {
    const kinds = new Set(
      template.widgets.map((w) => (w.config as { kind: string }).kind),
    )
    expect(kinds.size).toBe(10)
  })
})

describe('CrmDashboardService.createFromTemplate()', () => {
  it('creates the dashboard with its screens and widgets', async () => {
    dashboards.create.mockResolvedValue(
      ok(createFakeCrmDashboard({ id: 'd9', title: 'Vendas — TV' })),
    )
    widgets.create.mockResolvedValue(ok(createFakeCrmDashboardWidget()))
    const dto = expectOk(
      await CrmDashboardService.createFromTemplate('u1', 'ws1', {
        template: 'sales-tv',
      }),
    )
    expect(dto.id).toBe('d9')
    expect(dashboards.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      createdById: 'u1',
      title: 'Vendas — TV',
      module: 'CRM',
      settings: DASHBOARD_TEMPLATE_DATA['sales-tv'].settings,
    })
    expect(widgets.create).toHaveBeenCalledTimes(10)
    expect(widgets.create).toHaveBeenCalledWith(
      expect.objectContaining({ dashboardId: 'd9', type: 'SALES', page: 1 }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { template: 'sales-tv' } }),
    )
  })

  it('takes a custom title and logs widgets that fail', async () => {
    dashboards.create.mockResolvedValue(
      ok(createFakeCrmDashboard({ id: 'd9' })),
    )
    widgets.create.mockResolvedValue(err(databaseError()))
    expectOk(
      await CrmDashboardService.createFromTemplate('u1', 'ws1', {
        template: 'sales-tv',
        title: 'TV da sala',
      }),
    )
    expect(dashboards.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'TV da sala' }),
    )
    expect(logger.error).toHaveBeenCalledWith(
      'crm_dashboard.template.widget_failed',
      expect.objectContaining({ template: 'sales-tv' }),
    )
  })

  it('denies a VIEWER and propagates database errors', async () => {
    asRole('VIEWER')
    expectErr(
      await CrmDashboardService.createFromTemplate('u1', 'ws1', {
        template: 'sales-tv',
      }),
      'FORBIDDEN',
    )
    asRole('MEMBER')
    dashboards.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDashboardService.createFromTemplate('u1', 'ws1', {
        template: 'sales-tv',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmDashboardService.get()', () => {
  it('returns the dashboard with parsed screens', async () => {
    dashboards.findById.mockResolvedValue(
      ok(
        createFakeCrmDashboard({
          id: 'd1',
          module: 'CRM',
          settings: { pages: ['A', 'B'], rotateSeconds: 20 },
        }),
      ),
    )
    const dto = expectOk(await CrmDashboardService.get('u1', 'ws1', 'd1'))
    expect(dto.settings).toEqual({ pages: ['A', 'B'], rotateSeconds: 20 })
  })

  it('falls back to one screen for broken settings', async () => {
    dashboards.findById.mockResolvedValue(
      ok(createFakeCrmDashboard({ module: 'CRM', settings: { pages: 'x' } })),
    )
    const dto = expectOk(await CrmDashboardService.get('u1', 'ws1', 'd1'))
    expect(dto.settings).toEqual({ pages: ['Tela 1'], rotateSeconds: 0 })
  })

  it('hides ServiceDesk dashboards from the CRM route', async () => {
    dashboards.findById.mockResolvedValue(
      ok(createFakeCrmDashboard({ module: 'SERVICE_DESK' })),
    )
    expectErr(
      await CrmDashboardService.get('u1', 'ws1', 'd1'),
      'RESOURCE_NOT_FOUND',
    )
  })
})

describe('CrmDashboardService.lookups()', () => {
  it('returns pipelines, stages and members', async () => {
    salesRepo.listPipelines.mockResolvedValue(
      ok([{ id: 'p1', name: 'Vendas' }]),
    )
    salesRepo.listStages.mockResolvedValue(
      ok([
        {
          id: 's1',
          name: 'Ganho',
          pipelineId: 'p1',
          position: 3,
          probability: 100,
          color: null,
          category: 'WON',
        },
      ]),
    )
    salesRepo.listMembers.mockResolvedValue(
      ok([{ id: 'u1', name: 'Ana', image: null }]),
    )
    const lookups = expectOk(await CrmDashboardService.lookups('u1', 'ws1'))
    expect(lookups).toEqual({
      pipelines: [{ id: 'p1', name: 'Vendas' }],
      stages: [
        {
          id: 's1',
          name: 'Ganho',
          pipelineId: 'p1',
          category: 'WON',
          color: null,
        },
      ],
      users: [{ id: 'u1', name: 'Ana', image: null }],
    })
  })

  it('denies a non-member and propagates errors', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await CrmDashboardService.lookups('u1', 'ws1'), 'FORBIDDEN')
    asRole('MEMBER')
    salesRepo.listPipelines.mockResolvedValue(ok([]))
    salesRepo.listStages.mockResolvedValue(ok([]))
    salesRepo.listMembers.mockResolvedValue(err(databaseError()))
    expectErr(await CrmDashboardService.lookups('u1', 'ws1'), 'DATABASE_ERROR')
    salesRepo.listStages.mockResolvedValue(err(databaseError()))
    expectErr(await CrmDashboardService.lookups('u1', 'ws1'), 'DATABASE_ERROR')
    salesRepo.listPipelines.mockResolvedValue(err(databaseError()))
    expectErr(await CrmDashboardService.lookups('u1', 'ws1'), 'DATABASE_ERROR')
  })
})

describe('screens and sales widgets', () => {
  it('saves the screens of a dashboard', async () => {
    dashboards.findById.mockResolvedValue(
      ok(createFakeCrmDashboard({ module: 'CRM' })),
    )
    dashboards.update.mockResolvedValue(ok(createFakeCrmDashboard()))
    const settings = { pages: ['Metas', 'Funil'], rotateSeconds: 45 }
    expectOk(await CrmDashboardService.update('u1', 'ws1', 'd1', { settings }))
    expect(dashboards.update).toHaveBeenCalledWith('d1', {
      title: undefined,
      updatedById: 'u1',
      settings,
    })
  })

  it('creates a sales widget on a CRM dashboard, on its screen', async () => {
    dashboards.findById.mockResolvedValue(
      ok(createFakeCrmDashboard({ module: 'CRM' })),
    )
    widgets.create.mockResolvedValue(
      ok(createFakeCrmDashboardWidget({ type: 'SALES', page: 1 })),
    )
    const dto = expectOk(
      await CrmDashboardWidgetService.create('u1', 'ws1', 'd1', {
        type: 'SALES',
        config: { kind: 'goal', period: 'month', stalledDays: 14 },
        x: 0,
        y: 0,
        w: 5,
        h: 7,
        page: 1,
      }),
    )
    expect(dto.page).toBe(1)
    expect(widgets.create).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 }),
    )
  })

  it('refuses sales widgets on other modules', async () => {
    actAs('agent')
    dashboards.findById.mockResolvedValue(
      ok(createFakeCrmDashboard({ module: 'SERVICE_DESK' })),
    )
    expectErr(
      await CrmDashboardWidgetService.create(
        'u1',
        'ws1',
        'd1',
        {
          type: 'SALES',
          config: { kind: 'goal', period: 'month', stalledDays: 14 },
          x: 0,
          y: 0,
          w: 5,
          h: 7,
          page: 0,
        },
        'SERVICE_DESK',
      ),
      'CRM_SALES_WIDGET_UNSUPPORTED',
    )
    expect(widgets.create).not.toHaveBeenCalled()
  })

  it('moves a widget to another screen', async () => {
    dashboards.findById.mockResolvedValue(
      ok(createFakeCrmDashboard({ module: 'CRM' })),
    )
    widgets.findById.mockResolvedValue(ok(createFakeCrmDashboardWidget()))
    widgets.update.mockResolvedValue(
      ok(createFakeCrmDashboardWidget({ page: 2 })),
    )
    expectOk(
      await CrmDashboardWidgetService.update('u1', 'ws1', 'd1', 'w1', {
        page: 2,
      }),
    )
    expect(widgets.update).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ page: 2 }),
    )
  })

  it('validates the config of a sales widget on update', async () => {
    dashboards.findById.mockResolvedValue(
      ok(createFakeCrmDashboard({ module: 'CRM' })),
    )
    widgets.findById.mockResolvedValue(
      ok(createFakeCrmDashboardWidget({ type: 'SALES' })),
    )
    expectErr(
      await CrmDashboardWidgetService.update('u1', 'ws1', 'd1', 'w1', {
        config: { kind: 'unknown' },
      }),
      'VALIDATION_ERROR',
    )
  })

  it('duplicates screens and widget pages', async () => {
    dashboards.findById.mockResolvedValue(
      ok(
        createFakeCrmDashboard({
          module: 'CRM',
          settings: { pages: ['A', 'B'], rotateSeconds: 30 },
        }),
      ),
    )
    widgets.listByDashboard.mockResolvedValue(
      ok([createFakeCrmDashboardWidget({ page: 1 })]),
    )
    dashboards.create.mockResolvedValue(
      ok(createFakeCrmDashboard({ id: 'd2' })),
    )
    widgets.create.mockResolvedValue(ok(createFakeCrmDashboardWidget()))
    expectOk(await CrmDashboardService.duplicate('u1', 'ws1', 'd1'))
    expect(dashboards.create).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: { pages: ['A', 'B'], rotateSeconds: 30 },
      }),
    )
    expect(widgets.create).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 }),
    )
  })
})
