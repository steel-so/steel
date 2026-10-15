import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmDashboard,
  createFakeCrmDashboardWidget,
} from '@/src/__tests__/factories/crm-dashboard.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-dashboard.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { actAs } from '@/src/__tests__/helpers/sd-access.helpers'
import {
  CrmDashboardRepository,
  CrmDashboardWidgetRepository,
} from '@/src/repositories/crm-dashboard.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  CrmDashboardService,
  CrmDashboardWidgetService,
} from '../crm-dashboard.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedDashboardRepo = vi.mocked(CrmDashboardRepository)
const mockedWidgetRepo = vi.mocked(CrmDashboardWidgetRepository)
const mockedModuleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const mockedAudit = vi.mocked(auditMutation)

function asRole(role: Role) {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function moduleDisabled() {
  mockedModuleAccess.isEnabled.mockResolvedValue(ok(false))
}

const dashboard = () =>
  createFakeCrmDashboard({ id: 'd1', workspaceId: 'ws1', module: 'CRM' })

beforeEach(() => {
  mockedModuleAccess.isEnabled.mockResolvedValue(ok(true))
})

describe('CrmDashboardService', () => {
  describe('list()', () => {
    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await CrmDashboardService.list('u1', 'ws1'), 'FORBIDDEN')
    })

    it('should return MODULE_DISABLED when the CRM module is off', async () => {
      asRole('MEMBER')
      moduleDisabled()
      expectErr(await CrmDashboardService.list('u1', 'ws1'), 'MODULE_DISABLED')
    })

    it('should return WORKSPACE_SUSPENDED for a suspended workspace', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ workspaceStatus: 'SUSPENDED' })),
      )
      expectErr(
        await CrmDashboardService.list('u1', 'ws1'),
        'WORKSPACE_SUSPENDED',
      )
    })

    it('should return dashboards for a VIEWER', async () => {
      asRole('VIEWER')
      mockedDashboardRepo.listByWorkspace.mockResolvedValue(
        ok([createFakeCrmDashboard({ workspaceId: 'ws1' })]),
      )

      const dtos = expectOk(await CrmDashboardService.list('u1', 'ws1'))
      expect(dtos).toHaveLength(1)
      expect(mockedDashboardRepo.listByWorkspace).toHaveBeenCalledWith(
        'ws1',
        'CRM',
      )
    })

    it('should scope the listing to the requested module', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.listByWorkspace.mockResolvedValue(ok([]))
      expectOk(await CrmDashboardService.list('u1', 'ws1', 'COMMUNICATION'))
      expect(mockedDashboardRepo.listByWorkspace).toHaveBeenCalledWith(
        'ws1',
        'COMMUNICATION',
      )
    })

    it('should propagate a repository error', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.listByWorkspace.mockResolvedValue(
        err(databaseError()),
      )
      expectErr(await CrmDashboardService.list('u1', 'ws1'), 'DATABASE_ERROR')
    })
  })

  describe('create()', () => {
    it('should deny a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmDashboardService.create('u1', 'ws1', { title: 'X' }),
        'FORBIDDEN',
      )
      expect(mockedDashboardRepo.create).not.toHaveBeenCalled()
    })

    it('should create a dashboard for a MEMBER and audit it', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.create.mockResolvedValue(
        ok(createFakeCrmDashboard({ id: 'd9', title: 'Vendas' })),
      )

      const dto = expectOk(
        await CrmDashboardService.create('u1', 'ws1', { title: 'Vendas' }),
      )
      expect(dto.id).toBe('d9')
      expect(mockedDashboardRepo.create).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        createdById: 'u1',
        title: 'Vendas',
        module: 'CRM',
      })
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create', targetId: 'd9' }),
      )
    })

    it('should audit a failure when the repository fails', async () => {
      asRole('ADMIN')
      mockedDashboardRepo.create.mockResolvedValue(err(databaseError()))

      expectErr(
        await CrmDashboardService.create('u1', 'ws1', { title: 'X' }),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'failure',
          reason: 'DATABASE_ERROR',
        }),
      )
    })
  })

  describe('update()', () => {
    it('should deny a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmDashboardService.update('u1', 'ws1', 'd1', { title: 'X' }),
        'FORBIDDEN',
      )
    })

    it('should return not found for a dashboard outside the workspace', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(
        err(notFound('CrmDashboard')),
      )
      expectErr(
        await CrmDashboardService.update('u1', 'ws1', 'd1', { title: 'X' }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it("should return MODULE_DISABLED when the dashboard's module is off", async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      moduleDisabled()
      expectErr(
        await CrmDashboardService.update('u1', 'ws1', 'd1', { title: 'X' }),
        'MODULE_DISABLED',
      )
      expect(mockedDashboardRepo.update).not.toHaveBeenCalled()
    })

    it('should propagate an update failure', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedDashboardRepo.update.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmDashboardService.update('u1', 'ws1', 'd1', { title: 'X' }),
        'DATABASE_ERROR',
      )
    })

    it('should rename the dashboard and audit the changed fields', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedDashboardRepo.update.mockResolvedValue(
        ok(createFakeCrmDashboard({ id: 'd1', title: 'Novo' })),
      )

      const dto = expectOk(
        await CrmDashboardService.update('u1', 'ws1', 'd1', { title: 'Novo' }),
      )
      expect(dto.title).toBe('Novo')
      expect(mockedDashboardRepo.update).toHaveBeenCalledWith('d1', {
        title: 'Novo',
        updatedById: 'u1',
      })
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          meta: { fields: ['title'] },
        }),
      )
    })
  })

  describe('remove()', () => {
    it('should deny a MEMBER (members cannot delete dashboards)', async () => {
      asRole('MEMBER')
      expectErr(
        await CrmDashboardService.remove('u1', 'ws1', 'd1'),
        'FORBIDDEN',
      )
      expect(mockedDashboardRepo.softDelete).not.toHaveBeenCalled()
    })

    it('should return not found when the dashboard does not exist', async () => {
      asRole('ADMIN')
      mockedDashboardRepo.findById.mockResolvedValue(
        err(notFound('CrmDashboard')),
      )
      expectErr(
        await CrmDashboardService.remove('u1', 'ws1', 'd1'),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should return MODULE_DISABLED when the module is off', async () => {
      asRole('ADMIN')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      moduleDisabled()
      expectErr(
        await CrmDashboardService.remove('u1', 'ws1', 'd1'),
        'MODULE_DISABLED',
      )
    })

    it('should propagate a soft-delete failure', async () => {
      asRole('OWNER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedDashboardRepo.softDelete.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmDashboardService.remove('u1', 'ws1', 'd1'),
        'DATABASE_ERROR',
      )
    })

    it('should soft-delete for an ADMIN and audit it', async () => {
      asRole('ADMIN')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedDashboardRepo.softDelete.mockResolvedValue(ok(undefined as never))

      expectOk(await CrmDashboardService.remove('u1', 'ws1', 'd1'))
      expect(mockedDashboardRepo.softDelete).toHaveBeenCalledWith('d1')
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete', targetId: 'd1' }),
      )
    })
  })

  describe('reorder()', () => {
    it('should deny a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmDashboardService.reorder('u1', 'ws1', ['a', 'b']),
        'FORBIDDEN',
      )
    })

    it('should delegate the new order to the repository', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.reorder.mockResolvedValue(ok(undefined))
      expectOk(await CrmDashboardService.reorder('u1', 'ws1', ['b', 'a']))
      expect(mockedDashboardRepo.reorder).toHaveBeenCalledWith('ws1', [
        'b',
        'a',
      ])
    })
  })
})

describe('CrmDashboardWidgetService', () => {
  describe('list()', () => {
    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(
        await CrmDashboardWidgetService.list('u1', 'ws1', 'd1'),
        'FORBIDDEN',
      )
    })

    it('should return not found for an unknown dashboard', async () => {
      asRole('VIEWER')
      mockedDashboardRepo.findById.mockResolvedValue(
        err(notFound('CrmDashboard')),
      )
      expectErr(
        await CrmDashboardWidgetService.list('u1', 'ws1', 'd1'),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should return MODULE_DISABLED when the module is off', async () => {
      asRole('VIEWER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      moduleDisabled()
      expectErr(
        await CrmDashboardWidgetService.list('u1', 'ws1', 'd1'),
        'MODULE_DISABLED',
      )
    })

    it('should propagate a repository error', async () => {
      asRole('VIEWER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedWidgetRepo.listByDashboard.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmDashboardWidgetService.list('u1', 'ws1', 'd1'),
        'DATABASE_ERROR',
      )
    })

    it('should list the widgets of the dashboard for a VIEWER', async () => {
      asRole('VIEWER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedWidgetRepo.listByDashboard.mockResolvedValue(
        ok([
          createFakeCrmDashboardWidget({ dashboardId: 'd1' }),
          createFakeCrmDashboardWidget({ dashboardId: 'd1', type: 'IFRAME' }),
        ]),
      )
      const dtos = expectOk(
        await CrmDashboardWidgetService.list('u1', 'ws1', 'd1'),
      )
      expect(dtos.map((w) => w.type)).toEqual(['CHART', 'IFRAME'])
    })
  })

  describe('create()', () => {
    const dto = {
      type: 'IFRAME' as const,
      x: 0,
      y: 0,
      w: 4,
      h: 6,
      config: { url: 'https://example.com' },
    }

    it('should deny a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmDashboardWidgetService.create('u1', 'ws1', 'd1', dto),
        'FORBIDDEN',
      )
    })

    it('should return not found for an unknown dashboard', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(
        err(notFound('CrmDashboard')),
      )
      expectErr(
        await CrmDashboardWidgetService.create('u1', 'ws1', 'd1', dto),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should return MODULE_DISABLED when the module is off', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      moduleDisabled()
      expectErr(
        await CrmDashboardWidgetService.create('u1', 'ws1', 'd1', dto),
        'MODULE_DISABLED',
      )
    })

    it('should audit a failure when the repository fails', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedWidgetRepo.create.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmDashboardWidgetService.create('u1', 'ws1', 'd1', dto),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'crm_dashboard_widget',
          outcome: 'failure',
        }),
      )
    })

    it('should create the widget and audit it', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedWidgetRepo.create.mockResolvedValue(
        ok(createFakeCrmDashboardWidget({ id: 'w1', type: 'IFRAME' })),
      )
      const created = expectOk(
        await CrmDashboardWidgetService.create('u1', 'ws1', 'd1', dto),
      )
      expect(created.id).toBe('w1')
      expect(mockedWidgetRepo.create).toHaveBeenCalledWith({
        dashboardId: 'd1',
        ...dto,
      })
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create', targetId: 'w1' }),
      )
    })
  })

  describe('update()', () => {
    it('should deny a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmDashboardWidgetService.update('u1', 'ws1', 'd1', 'w1', {
          x: 1,
        }),
        'FORBIDDEN',
      )
    })

    it('should return not found for an unknown dashboard', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(
        err(notFound('CrmDashboard')),
      )
      expectErr(
        await CrmDashboardWidgetService.update('u1', 'ws1', 'd1', 'w1', {
          x: 1,
        }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should return MODULE_DISABLED when the module is off', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      moduleDisabled()
      expectErr(
        await CrmDashboardWidgetService.update('u1', 'ws1', 'd1', 'w1', {
          x: 1,
        }),
        'MODULE_DISABLED',
      )
    })

    it('should return not found for a widget of another dashboard', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedWidgetRepo.findById.mockResolvedValue(
        err(notFound('CrmDashboardWidget')),
      )
      expectErr(
        await CrmDashboardWidgetService.update('u1', 'ws1', 'd1', 'w1', {
          x: 1,
        }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should reject a config that does not match the widget type schema', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedWidgetRepo.findById.mockResolvedValue(
        ok(createFakeCrmDashboardWidget({ id: 'w1', type: 'IFRAME' })),
      )

      expectErr(
        await CrmDashboardWidgetService.update('u1', 'ws1', 'd1', 'w1', {
          config: { url: 'not-a-url' },
        }),
        'VALIDATION_ERROR',
      )
      expect(mockedWidgetRepo.update).not.toHaveBeenCalled()
    })

    it('should accept a config that matches the widget type schema', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedWidgetRepo.findById.mockResolvedValue(
        ok(createFakeCrmDashboardWidget({ id: 'w1', type: 'IFRAME' })),
      )
      mockedWidgetRepo.update.mockResolvedValue(
        ok(createFakeCrmDashboardWidget({ id: 'w1', type: 'IFRAME' })),
      )

      expectOk(
        await CrmDashboardWidgetService.update('u1', 'ws1', 'd1', 'w1', {
          config: { url: 'https://example.com' },
        }),
      )
      expect(mockedWidgetRepo.update).toHaveBeenCalledWith(
        'w1',
        expect.objectContaining({ config: { url: 'https://example.com' } }),
      )
    })

    it('should update only the layout when no config is sent', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedWidgetRepo.findById.mockResolvedValue(
        ok(createFakeCrmDashboardWidget({ id: 'w1' })),
      )
      mockedWidgetRepo.update.mockResolvedValue(
        ok(createFakeCrmDashboardWidget({ id: 'w1', x: 2 })),
      )

      const dto = expectOk(
        await CrmDashboardWidgetService.update('u1', 'ws1', 'd1', 'w1', {
          x: 2,
        }),
      )
      expect(dto.x).toBe(2)
      expect(mockedWidgetRepo.update).toHaveBeenCalledWith('w1', {
        x: 2,
        y: undefined,
        w: undefined,
        h: undefined,
        config: undefined,
      })
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'update', meta: { fields: ['x'] } }),
      )
    })

    it('should propagate an update failure', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedWidgetRepo.findById.mockResolvedValue(
        ok(createFakeCrmDashboardWidget({ id: 'w1' })),
      )
      mockedWidgetRepo.update.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmDashboardWidgetService.update('u1', 'ws1', 'd1', 'w1', {
          x: 2,
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('remove()', () => {
    it('should deny a MEMBER (members cannot delete widgets)', async () => {
      asRole('MEMBER')
      expectErr(
        await CrmDashboardWidgetService.remove('u1', 'ws1', 'd1', 'w1'),
        'FORBIDDEN',
      )
    })

    it('should return not found for an unknown dashboard', async () => {
      asRole('ADMIN')
      mockedDashboardRepo.findById.mockResolvedValue(
        err(notFound('CrmDashboard')),
      )
      expectErr(
        await CrmDashboardWidgetService.remove('u1', 'ws1', 'd1', 'w1'),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should return MODULE_DISABLED when the module is off', async () => {
      asRole('ADMIN')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      moduleDisabled()
      expectErr(
        await CrmDashboardWidgetService.remove('u1', 'ws1', 'd1', 'w1'),
        'MODULE_DISABLED',
      )
    })

    it('should return not found for an unknown widget', async () => {
      asRole('ADMIN')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedWidgetRepo.findById.mockResolvedValue(
        err(notFound('CrmDashboardWidget')),
      )
      expectErr(
        await CrmDashboardWidgetService.remove('u1', 'ws1', 'd1', 'w1'),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedWidgetRepo.delete).not.toHaveBeenCalled()
    })

    it('should propagate a delete failure', async () => {
      asRole('ADMIN')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedWidgetRepo.findById.mockResolvedValue(
        ok(createFakeCrmDashboardWidget({ id: 'w1' })),
      )
      mockedWidgetRepo.delete.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmDashboardWidgetService.remove('u1', 'ws1', 'd1', 'w1'),
        'DATABASE_ERROR',
      )
    })

    it('should delete the widget for an ADMIN and audit it', async () => {
      asRole('ADMIN')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedWidgetRepo.findById.mockResolvedValue(
        ok(createFakeCrmDashboardWidget({ id: 'w1' })),
      )
      mockedWidgetRepo.delete.mockResolvedValue(ok(undefined as never))
      expectOk(await CrmDashboardWidgetService.remove('u1', 'ws1', 'd1', 'w1'))
      expect(mockedWidgetRepo.delete).toHaveBeenCalledWith('w1')
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete', targetId: 'w1' }),
      )
    })
  })

  describe('applyLayout()', () => {
    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(
        await CrmDashboardWidgetService.applyLayout('u1', 'ws1', 'd1', {
          items: [],
        }),
        'FORBIDDEN',
      )
    })

    it('should return not found for an unknown dashboard', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(
        err(notFound('CrmDashboard')),
      )
      expectErr(
        await CrmDashboardWidgetService.applyLayout('u1', 'ws1', 'd1', {
          items: [],
        }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should return MODULE_DISABLED when the module is off', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      moduleDisabled()
      expectErr(
        await CrmDashboardWidgetService.applyLayout('u1', 'ws1', 'd1', {
          items: [],
        }),
        'MODULE_DISABLED',
      )
    })

    it('should batch-apply positions for a workspace member', async () => {
      asRole('MEMBER')
      mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
      mockedWidgetRepo.applyLayout.mockResolvedValue(ok(undefined))

      expectOk(
        await CrmDashboardWidgetService.applyLayout('u1', 'ws1', 'd1', {
          items: [{ id: 'w1', x: 0, y: 0, w: 4, h: 6 }],
        }),
      )
      expect(mockedWidgetRepo.applyLayout).toHaveBeenCalledWith('d1', [
        { id: 'w1', x: 0, y: 0, w: 4, h: 6 },
      ])
    })
  })
})

describe('ServiceDesk dashboards (module SERVICE_DESK)', () => {
  const sdDashboard = () =>
    createFakeCrmDashboard({
      id: 'sd1',
      workspaceId: 'ws1',
      module: 'SERVICE_DESK',
      title: 'KPIs (TV)',
    })

  it('lists for agents with sd-dashboards and refuses requesters', async () => {
    actAs('agent')
    mockedDashboardRepo.listByWorkspace.mockResolvedValue(ok([sdDashboard()]))
    expectOk(await CrmDashboardService.list('u1', 'ws1', 'SERVICE_DESK'))
    expect(mockedDashboardRepo.listByWorkspace).toHaveBeenCalledWith(
      'ws1',
      'SERVICE_DESK',
    )

    actAs('requester')
    expectErr(
      await CrmDashboardService.list('u1', 'ws1', 'SERVICE_DESK'),
      'SD_NOT_AGENT',
    )
  })

  it('uses the sd-dashboards permission, not the CRM one', async () => {
    actAs('agent')
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(
        createFakeMembership({
          role: 'MEMBER',
          profile: {
            id: 'p1',
            workspaceId: 'ws1',
            name: 'Só CRM',
            description: null,
            isSystem: false,
            systemKey: null,
            permissions: { dashboards: ['VIEW', 'CREATE'] },
            createdAt: new Date(),
            updatedAt: new Date(),
          } as never,
        }),
      ),
    )
    expectErr(
      await CrmDashboardService.create(
        'u1',
        'ws1',
        { title: 'X' },
        'SERVICE_DESK',
      ),
      'FORBIDDEN',
    )
  })

  it('creates, renames and deletes SERVICE_DESK dashboards for agents', async () => {
    actAs('agent')
    mockedDashboardRepo.create.mockResolvedValue(ok(sdDashboard()))
    expectOk(
      await CrmDashboardService.create(
        'u1',
        'ws1',
        { title: 'Fila' },
        'SERVICE_DESK',
      ),
    )
    expect(mockedDashboardRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'SERVICE_DESK' }),
    )

    mockedDashboardRepo.findById.mockResolvedValue(ok(sdDashboard()))
    mockedDashboardRepo.update.mockResolvedValue(ok(sdDashboard()))
    expectOk(
      await CrmDashboardService.update(
        'u1',
        'ws1',
        'sd1',
        { title: 'Novo' },
        'SERVICE_DESK',
      ),
    )

    actAs('admin')
    mockedDashboardRepo.softDelete.mockResolvedValue(ok(undefined as never))
    expectOk(
      await CrmDashboardService.remove('u1', 'ws1', 'sd1', 'SERVICE_DESK'),
    )
  })

  it('refuses a MEMBER agent deleting (sd-dashboards has no DELETE)', async () => {
    actAs('agent')
    expectErr(
      await CrmDashboardService.remove('u1', 'ws1', 'sd1', 'SERVICE_DESK'),
      'FORBIDDEN',
    )
    expect(mockedDashboardRepo.findById).not.toHaveBeenCalled()
  })

  it('never crosses modules through the ServiceDesk or CRM routes', async () => {
    actAs('agent')
    mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
    expectErr(
      await CrmDashboardService.update(
        'u1',
        'ws1',
        'd1',
        { title: 'X' },
        'SERVICE_DESK',
      ),
      'RESOURCE_NOT_FOUND',
    )

    asRole('OWNER')
    mockedDashboardRepo.findById.mockResolvedValue(ok(sdDashboard()))
    expectErr(
      await CrmDashboardService.update('u1', 'ws1', 'sd1', { title: 'X' }),
      'RESOURCE_NOT_FOUND',
    )
    expectErr(
      await CrmDashboardWidgetService.list('u1', 'ws1', 'sd1'),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('propagates a missing ServiceDesk dashboard', async () => {
    actAs('agent')
    mockedDashboardRepo.findById.mockResolvedValue(
      err(notFound('CrmDashboard')),
    )
    expectErr(
      await CrmDashboardWidgetService.list('u1', 'ws1', 'x', 'SERVICE_DESK'),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('manages widgets of a ServiceDesk dashboard', async () => {
    actAs('agent')
    mockedDashboardRepo.findById.mockResolvedValue(ok(sdDashboard()))
    mockedWidgetRepo.listByDashboard.mockResolvedValue(
      ok([createFakeCrmDashboardWidget({ dashboardId: 'sd1' })]),
    )
    const list = expectOk(
      await CrmDashboardWidgetService.list('u1', 'ws1', 'sd1', 'SERVICE_DESK'),
    )
    expect(list).toHaveLength(1)

    mockedWidgetRepo.create.mockResolvedValue(
      ok(createFakeCrmDashboardWidget({ dashboardId: 'sd1' })),
    )
    expectOk(
      await CrmDashboardWidgetService.create(
        'u1',
        'ws1',
        'sd1',
        {
          type: 'CHART',
          config: { chartType: 'aggregate', source: 'sd-tickets' } as never,
          x: 0,
          y: 0,
          w: 3,
          h: 4,
        },
        'SERVICE_DESK',
      ),
    )

    mockedWidgetRepo.applyLayout.mockResolvedValue(ok(undefined))
    expectOk(
      await CrmDashboardWidgetService.applyLayout(
        'u1',
        'ws1',
        'sd1',
        { items: [] },
        'SERVICE_DESK',
      ),
    )
  })
})

describe('CrmDashboardService.duplicate()', () => {
  it('copies the dashboard and its widgets in the same module', async () => {
    asRole('MEMBER')
    mockedDashboardRepo.findById.mockResolvedValue(
      ok(createFakeCrmDashboard({ id: 'd1', title: 'Vendas', module: 'CRM' })),
    )
    mockedWidgetRepo.listByDashboard.mockResolvedValue(
      ok([
        createFakeCrmDashboardWidget({ id: 'w1', x: 1 }),
        createFakeCrmDashboardWidget({ id: 'w2', x: 2 }),
      ]),
    )
    mockedDashboardRepo.create.mockResolvedValue(
      ok(createFakeCrmDashboard({ id: 'd2', title: 'Vendas (cópia)' })),
    )
    mockedWidgetRepo.create.mockResolvedValue(
      ok(createFakeCrmDashboardWidget()),
    )

    const dto = expectOk(await CrmDashboardService.duplicate('u1', 'ws1', 'd1'))
    expect(dto.id).toBe('d2')
    expect(mockedDashboardRepo.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      createdById: 'u1',
      title: 'Vendas (cópia)',
      module: 'CRM',
      settings: {},
    })
    expect(mockedWidgetRepo.create).toHaveBeenCalledTimes(2)
    expect(mockedWidgetRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ dashboardId: 'd2', x: 2 }),
    )
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: { duplicatedFrom: 'd1', module: 'CRM' },
      }),
    )
  })

  it('keeps the title within 200 chars and logs failed widget copies', async () => {
    actAs('agent')
    mockedDashboardRepo.findById.mockResolvedValue(
      ok(
        createFakeCrmDashboard({
          id: 'sd1',
          module: 'SERVICE_DESK',
          title: 'x'.repeat(200),
        }),
      ),
    )
    mockedWidgetRepo.listByDashboard.mockResolvedValue(
      ok([createFakeCrmDashboardWidget()]),
    )
    mockedDashboardRepo.create.mockResolvedValue(
      ok(createFakeCrmDashboard({ id: 'sd2', module: 'SERVICE_DESK' })),
    )
    mockedWidgetRepo.create.mockResolvedValue(err(databaseError()))

    expectOk(
      await CrmDashboardService.duplicate('u1', 'ws1', 'sd1', 'SERVICE_DESK'),
    )
    const title = mockedDashboardRepo.create.mock.calls[0][0].title
    expect(title).toHaveLength(200)
    expect(title.endsWith(' (cópia)')).toBe(true)
    expect(logger.error).toHaveBeenCalledWith(
      'crm_dashboard.duplicate.widget_failed',
      expect.objectContaining({ dashboardId: 'sd2' }),
    )
  })

  it('propagates authorization, listing and creation failures', async () => {
    asRole('VIEWER')
    expectErr(
      await CrmDashboardService.duplicate('u1', 'ws1', 'd1'),
      'FORBIDDEN',
    )

    asRole('MEMBER')
    mockedDashboardRepo.findById.mockResolvedValue(ok(dashboard()))
    mockedWidgetRepo.listByDashboard.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDashboardService.duplicate('u1', 'ws1', 'd1'),
      'DATABASE_ERROR',
    )

    mockedWidgetRepo.listByDashboard.mockResolvedValue(ok([]))
    mockedDashboardRepo.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmDashboardService.duplicate('u1', 'ws1', 'd1'),
      'DATABASE_ERROR',
    )
  })
})
