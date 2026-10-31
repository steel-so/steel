import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeSdStatusPage } from '@/src/__tests__/factories/nov-s2-major-incident.factory'
import {
  createFakeSdStatusComponent,
  createFakeSdStatusMaintenance,
} from '@/src/__tests__/factories/nov-sd-followups.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, sdStatusComponentNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-major-incident.repository')
vi.mock('@/src/repositories/sd-status-component.repository')
vi.mock('@/src/repositories/sd-status-maintenance.repository')
vi.mock('@/src/repositories/sd-status-page.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('@/src/lib/servicedesk/status-notify-queue', () => ({
  enqueueSdMaintenanceNotice: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { enqueueSdMaintenanceNotice } from '@/src/lib/servicedesk/status-notify-queue'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SdAccessRepository } from '@/src/repositories/sd-access.repository'
import { SdMajorIncidentRepository } from '@/src/repositories/sd-major-incident.repository'
import { SdStatusComponentRepository } from '@/src/repositories/sd-status-component.repository'
import { SdStatusMaintenanceRepository } from '@/src/repositories/sd-status-maintenance.repository'
import { SdStatusPageRepository } from '@/src/repositories/sd-status-page.repository'
import { SdStatusMaintenanceService } from '../sd-status-maintenance.service'

const components = vi.mocked(SdStatusComponentRepository)
const windows = vi.mocked(SdStatusMaintenanceRepository)
const pages = vi.mocked(SdStatusPageRepository)
const incidents = vi.mocked(SdMajorIncidentRepository)
const notice = vi.mocked(enqueueSdMaintenanceNotice)

const WS = 'ws1'
const HOUR = 3_600_000

function as(who: 'admin' | 'agent' | 'requester') {
  const role: Role = who === 'admin' ? 'ADMIN' : 'MEMBER'
  vi.mocked(MembershipRepository).findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
  vi.mocked(SdAccessRepository).listDepartmentLinks.mockResolvedValue(
    ok(
      who === 'agent'
        ? [{ departmentId: 'd', parentId: null, isLead: false }]
        : [],
    ),
  )
}

function future(startHours: number, endHours: number) {
  const now = Date.now()
  return {
    startsAt: new Date(now + startHours * HOUR),
    endsAt: new Date(now + endHours * HOUR),
  }
}

const base = {
  title: 'Troca do switch',
  pageIds: ['p1'],
  suppressMonitoring: false,
  configItemIds: [] as string[],
  notifySubscribers: true,
  ...future(24, 28),
}

beforeEach(() => {
  vi.clearAllMocks()
  as('admin')
  pages.findById.mockResolvedValue(ok(createFakeSdStatusPage()))
  pages.findNames.mockResolvedValue(
    ok({ services: new Map([['s1', 'Telefonia']]), customers: new Map() }),
  )
  components.listByPage.mockResolvedValue(ok([createFakeSdStatusComponent()]))
  components.create.mockResolvedValue(ok(createFakeSdStatusComponent()))
  components.update.mockResolvedValue(
    ok(createFakeSdStatusComponent({ state: 'DEGRADED' })),
  )
  components.remove.mockResolvedValue(ok(true))
  incidents.countPages.mockResolvedValue(ok(1))
  windows.findConfigItemNames.mockImplementation(async (_ws, ids) =>
    ok(new Map(ids.map((id) => [id, 'SRV-01']))),
  )
  windows.create.mockResolvedValue(
    ok(createFakeSdStatusMaintenance({ configItemIds: ['ci1'] })),
  )
  windows.findById.mockResolvedValue(
    ok(createFakeSdStatusMaintenance({ ...future(24, 28) })),
  )
  windows.update.mockResolvedValue(ok(createFakeSdStatusMaintenance()))
  windows.cancel.mockResolvedValue(
    ok(
      createFakeSdStatusMaintenance({
        canceledAt: new Date(),
        announcedAt: new Date(),
      }),
    ),
  )
  windows.list.mockResolvedValue(
    ok([createFakeSdStatusMaintenance({ configItemIds: ['ci1'] })]),
  )
})

describe('components', () => {
  it('lists for agents', async () => {
    as('agent')
    const out = expectOk(
      await SdStatusMaintenanceService.listComponents('u', WS, 'p1'),
    )
    expect(out.items).toMatchObject([{ id: 'cmp1', name: 'Telefonia' }])
    expect(components.listByPage).toHaveBeenCalledWith('p1', WS)
  })

  it('refuses a requester and an unknown page, and propagates errors', async () => {
    as('requester')
    expectErr(
      await SdStatusMaintenanceService.listComponents('u', WS, 'p1'),
      'SD_NOT_AGENT',
    )
    as('agent')
    pages.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.listComponents('u', WS, 'p1'),
      'DATABASE_ERROR',
    )
    pages.findById.mockResolvedValue(ok(createFakeSdStatusPage()))
    components.listByPage.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.listComponents('u', WS, 'p1'),
      'DATABASE_ERROR',
    )
  })

  it('lets the admin create one, checking the catalog service', async () => {
    expectOk(
      await SdStatusMaintenanceService.createComponent('u', WS, 'p1', {
        name: 'Telefonia',
        serviceId: 's1',
        state: 'OPERATIONAL',
      }),
    )
    expect(components.create).toHaveBeenCalledWith({
      workspaceId: WS,
      pageId: 'p1',
      name: 'Telefonia',
      serviceId: 's1',
      state: 'OPERATIONAL',
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_status_component',
        action: 'create',
      }),
    )
    expectOk(
      await SdStatusMaintenanceService.createComponent('u', WS, 'p1', {
        name: 'Portal',
        state: 'DEGRADED',
      }),
    )
    expect(components.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ serviceId: null }),
    )
  })

  it('refuses creation for non-admins, unknown services and failing lookups', async () => {
    as('agent')
    expectErr(
      await SdStatusMaintenanceService.createComponent('u', WS, 'p1', {
        name: 'x1',
        state: 'OPERATIONAL',
      }),
      'FORBIDDEN',
    )
    as('admin')
    expectErr(
      await SdStatusMaintenanceService.createComponent('u', WS, 'p1', {
        name: 'Telefonia',
        serviceId: 'nope',
        state: 'OPERATIONAL',
      }),
      'VALIDATION_ERROR',
    )
    pages.findNames.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.createComponent('u', WS, 'p1', {
        name: 'Telefonia',
        serviceId: 's1',
        state: 'OPERATIONAL',
      }),
      'DATABASE_ERROR',
    )
    pages.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.createComponent('u', WS, 'p1', {
        name: 'Telefonia',
        state: 'OPERATIONAL',
      }),
      'DATABASE_ERROR',
    )
    pages.findById.mockResolvedValue(ok(createFakeSdStatusPage()))
    components.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.createComponent('u', WS, 'p1', {
        name: 'Telefonia',
        state: 'OPERATIONAL',
      }),
      'DATABASE_ERROR',
    )
  })

  it('lets an agent change only the state; the rest is the admin', async () => {
    as('agent')
    const out = expectOk(
      await SdStatusMaintenanceService.updateComponent('u', WS, 'p1', 'cmp1', {
        state: 'DEGRADED',
      }),
    )
    expect(out.state).toBe('DEGRADED')
    expect(components.update).toHaveBeenCalledWith('cmp1', 'p1', WS, {
      state: 'DEGRADED',
    })
    expectErr(
      await SdStatusMaintenanceService.updateComponent('u', WS, 'p1', 'cmp1', {
        name: 'Outro nome',
      }),
      'FORBIDDEN',
    )
    expectErr(
      await SdStatusMaintenanceService.updateComponent('u', WS, 'p1', 'cmp1', {
        state: 'OUTAGE',
        position: 2,
      }),
      'FORBIDDEN',
    )
    as('admin')
    expectOk(
      await SdStatusMaintenanceService.updateComponent('u', WS, 'p1', 'cmp1', {
        name: 'Outro nome',
        serviceId: 's1',
      }),
    )
  })

  it('validates the service on update and propagates repository errors', async () => {
    expectErr(
      await SdStatusMaintenanceService.updateComponent('u', WS, 'p1', 'cmp1', {
        serviceId: 'nope',
      }),
      'VALIDATION_ERROR',
    )
    components.update.mockResolvedValue(err(sdStatusComponentNotFound()))
    expectErr(
      await SdStatusMaintenanceService.updateComponent('u', WS, 'p1', 'zz', {
        state: 'OUTAGE',
      }),
      'SD_STATUS_COMPONENT_NOT_FOUND',
    )
    as('requester')
    expectErr(
      await SdStatusMaintenanceService.updateComponent('u', WS, 'p1', 'cmp1', {
        state: 'OUTAGE',
      }),
      'SD_NOT_AGENT',
    )
  })

  it('removes for the admin only', async () => {
    expectOk(
      await SdStatusMaintenanceService.removeComponent('u', WS, 'p1', 'cmp1'),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete' }),
    )
    components.remove.mockResolvedValue(err(sdStatusComponentNotFound()))
    expectErr(
      await SdStatusMaintenanceService.removeComponent('u', WS, 'p1', 'cmp1'),
      'SD_STATUS_COMPONENT_NOT_FOUND',
    )
    as('agent')
    expectErr(
      await SdStatusMaintenanceService.removeComponent('u', WS, 'p1', 'cmp1'),
      'FORBIDDEN',
    )
  })
})

describe('listMaintenances', () => {
  it('lists with the config item names resolved', async () => {
    as('agent')
    const out = expectOk(
      await SdStatusMaintenanceService.listMaintenances('u', WS),
    )
    expect(out.items[0]).toMatchObject({
      id: 'mw1',
      phase: expect.stringMatching(/SCHEDULED|FINISHED|IN_PROGRESS/),
      configItems: [{ id: 'ci1', name: 'SRV-01' }],
      pages: [{ id: 'p1', name: 'Acme', slug: 'acme-abc123' }],
    })
    const since = windows.list.mock.calls[0][1]
    expect(Date.now() - since.getTime()).toBeGreaterThan(6 * 24 * HOUR)
  })

  it('refuses requesters and propagates errors', async () => {
    as('requester')
    expectErr(
      await SdStatusMaintenanceService.listMaintenances('u', WS),
      'SD_NOT_AGENT',
    )
    as('agent')
    windows.list.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.listMaintenances('u', WS),
      'DATABASE_ERROR',
    )
    windows.list.mockResolvedValue(ok([createFakeSdStatusMaintenance()]))
    windows.findConfigItemNames.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.listMaintenances('u', WS),
      'DATABASE_ERROR',
    )
  })
})

describe('createMaintenance', () => {
  it('creates, announces and audits', async () => {
    as('agent')
    const out = expectOk(
      await SdStatusMaintenanceService.createMaintenance('u', WS, {
        ...base,
        suppressMonitoring: true,
        configItemIds: ['ci1', 'ci1'],
      }),
    )
    expect(out.id).toBe('mw1')
    expect(windows.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({
        pageIds: ['p1'],
        configItemIds: ['ci1'],
        suppressMonitoring: true,
        createdById: 'u',
        description: null,
      }),
    )
    expect(notice).toHaveBeenCalledWith('mw1', 'scheduled')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_status_maintenance',
        action: 'create',
      }),
    )
  })

  it('does not announce when notices are off', async () => {
    windows.create.mockResolvedValue(
      ok(createFakeSdStatusMaintenance({ notifySubscribers: false })),
    )
    expectOk(
      await SdStatusMaintenanceService.createMaintenance('u', WS, {
        ...base,
        notifySubscribers: false,
      }),
    )
    expect(notice).not.toHaveBeenCalled()
  })

  it('validates the window', async () => {
    const run = (patch: object) =>
      SdStatusMaintenanceService.createMaintenance('u', WS, {
        ...base,
        ...patch,
      })
    expectErr(await run({ endsAt: base.startsAt }), 'SD_MAINTENANCE_INVALID')
    expectErr(await run(future(24, 24 + 31 * 24)), 'SD_MAINTENANCE_INVALID')
    expectErr(
      await run({ suppressMonitoring: true, configItemIds: [] }),
      'SD_MAINTENANCE_INVALID',
    )
    expectErr(await run(future(-5, -1)), 'SD_MAINTENANCE_INVALID')
    expect(windows.create).not.toHaveBeenCalled()
  })

  it('checks pages and CMDB items of the workspace', async () => {
    incidents.countPages.mockResolvedValue(ok(0))
    expectErr(
      await SdStatusMaintenanceService.createMaintenance('u', WS, base),
      'VALIDATION_ERROR',
    )
    incidents.countPages.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.createMaintenance('u', WS, base),
      'DATABASE_ERROR',
    )
    incidents.countPages.mockResolvedValue(ok(1))
    windows.findConfigItemNames.mockResolvedValue(ok(new Map()))
    expectErr(
      await SdStatusMaintenanceService.createMaintenance('u', WS, {
        ...base,
        configItemIds: ['ci1'],
      }),
      'VALIDATION_ERROR',
    )
    windows.findConfigItemNames.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.createMaintenance('u', WS, {
        ...base,
        configItemIds: ['ci1'],
      }),
      'DATABASE_ERROR',
    )
  })

  it('refuses requesters, propagates the write error and a failing name lookup', async () => {
    as('requester')
    expectErr(
      await SdStatusMaintenanceService.createMaintenance('u', WS, base),
      'SD_NOT_AGENT',
    )
    as('agent')
    windows.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.createMaintenance('u', WS, base),
      'DATABASE_ERROR',
    )
    windows.create.mockResolvedValue(ok(createFakeSdStatusMaintenance()))
    windows.findConfigItemNames.mockResolvedValueOnce(ok(new Map()))
    windows.findConfigItemNames.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.createMaintenance('u', WS, base),
      'DATABASE_ERROR',
    )
  })
})

describe('updateMaintenance', () => {
  it('updates fields without re-announcing when the time did not change', async () => {
    const current = createFakeSdStatusMaintenance({
      ...future(24, 28),
      announcedAt: new Date(),
    })
    windows.findById.mockResolvedValue(ok(current))
    expectOk(
      await SdStatusMaintenanceService.updateMaintenance('u', WS, 'mw1', {
        title: 'Novo título',
        pageIds: ['p1'],
        configItemIds: ['ci1'],
      }),
    )
    expect(windows.update).toHaveBeenCalledWith(
      'mw1',
      WS,
      expect.objectContaining({
        title: 'Novo título',
        pageIds: ['p1'],
        configItemIds: ['ci1'],
        resetAnnouncement: false,
      }),
    )
    expect(notice).not.toHaveBeenCalled()
  })

  it('announces again when an announced window is rescheduled', async () => {
    windows.findById.mockResolvedValue(
      ok(
        createFakeSdStatusMaintenance({
          ...future(24, 28),
          announcedAt: new Date(),
        }),
      ),
    )
    expectOk(
      await SdStatusMaintenanceService.updateMaintenance('u', WS, 'mw1', {
        ...future(48, 52),
      }),
    )
    expect(windows.update).toHaveBeenCalledWith(
      'mw1',
      WS,
      expect.objectContaining({ resetAnnouncement: true }),
    )
    expect(notice).toHaveBeenCalledWith('mw1', 'rescheduled')
  })

  it('does not re-announce a window that was never announced or has notices off', async () => {
    expectOk(
      await SdStatusMaintenanceService.updateMaintenance('u', WS, 'mw1', {
        ...future(48, 52),
      }),
    )
    windows.findById.mockResolvedValue(
      ok(
        createFakeSdStatusMaintenance({
          ...future(24, 28),
          announcedAt: new Date(),
        }),
      ),
    )
    expectOk(
      await SdStatusMaintenanceService.updateMaintenance('u', WS, 'mw1', {
        ...future(48, 52),
        notifySubscribers: false,
      }),
    )
    expect(notice).not.toHaveBeenCalled()
  })

  it('refuses closed windows, bad windows and unknown references', async () => {
    windows.findById.mockResolvedValue(
      ok(createFakeSdStatusMaintenance({ canceledAt: new Date() })),
    )
    expectErr(
      await SdStatusMaintenanceService.updateMaintenance('u', WS, 'mw1', {
        title: 'abc',
      }),
      'SD_MAINTENANCE_CLOSED',
    )
    windows.findById.mockResolvedValue(
      ok(createFakeSdStatusMaintenance({ ...future(-8, -4) })),
    )
    expectErr(
      await SdStatusMaintenanceService.updateMaintenance('u', WS, 'mw1', {
        title: 'abc',
      }),
      'SD_MAINTENANCE_CLOSED',
    )
    windows.findById.mockResolvedValue(
      ok(createFakeSdStatusMaintenance({ ...future(24, 28) })),
    )
    expectErr(
      await SdStatusMaintenanceService.updateMaintenance('u', WS, 'mw1', {
        endsAt: new Date(Date.now() - HOUR),
      }),
      'SD_MAINTENANCE_INVALID',
    )
    expectErr(
      await SdStatusMaintenanceService.updateMaintenance('u', WS, 'mw1', {
        suppressMonitoring: true,
      }),
      'SD_MAINTENANCE_INVALID',
    )
    windows.findConfigItemNames.mockResolvedValue(ok(new Map()))
    incidents.countPages.mockResolvedValue(ok(0))
    expectErr(
      await SdStatusMaintenanceService.updateMaintenance('u', WS, 'mw1', {
        pageIds: ['zz'],
      }),
      'VALIDATION_ERROR',
    )
    expectErr(
      await SdStatusMaintenanceService.updateMaintenance('u', WS, 'mw1', {
        configItemIds: ['zz'],
      }),
      'VALIDATION_ERROR',
    )
  })

  it('refuses requesters, propagates lookup, write and name errors', async () => {
    as('requester')
    expectErr(
      await SdStatusMaintenanceService.updateMaintenance('u', WS, 'mw1', {
        title: 'abc',
      }),
      'SD_NOT_AGENT',
    )
    as('agent')
    windows.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.updateMaintenance('u', WS, 'mw1', {
        title: 'abc',
      }),
      'DATABASE_ERROR',
    )
    windows.findById.mockResolvedValue(
      ok(createFakeSdStatusMaintenance({ ...future(24, 28) })),
    )
    windows.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.updateMaintenance('u', WS, 'mw1', {
        title: 'abc',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('cancelMaintenance', () => {
  it('cancels and tells the subscribers who heard about it', async () => {
    as('agent')
    const out = expectOk(
      await SdStatusMaintenanceService.cancelMaintenance('u', WS, 'mw1'),
    )
    expect(out.phase).toBe('CANCELED')
    expect(notice).toHaveBeenCalledWith('mw1', 'canceled')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cancel' }),
    )
  })

  it('stays quiet when it was never announced or notices are off', async () => {
    windows.cancel.mockResolvedValue(
      ok(createFakeSdStatusMaintenance({ canceledAt: new Date() })),
    )
    expectOk(await SdStatusMaintenanceService.cancelMaintenance('u', WS, 'mw1'))
    windows.cancel.mockResolvedValue(
      ok(
        createFakeSdStatusMaintenance({
          canceledAt: new Date(),
          announcedAt: new Date(),
          notifySubscribers: false,
        }),
      ),
    )
    expectOk(await SdStatusMaintenanceService.cancelMaintenance('u', WS, 'mw1'))
    expect(notice).not.toHaveBeenCalled()
  })

  it('refuses closed windows, requesters and propagates errors', async () => {
    windows.findById.mockResolvedValue(
      ok(createFakeSdStatusMaintenance({ canceledAt: new Date() })),
    )
    expectErr(
      await SdStatusMaintenanceService.cancelMaintenance('u', WS, 'mw1'),
      'SD_MAINTENANCE_CLOSED',
    )
    windows.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.cancelMaintenance('u', WS, 'mw1'),
      'DATABASE_ERROR',
    )
    windows.findById.mockResolvedValue(
      ok(createFakeSdStatusMaintenance({ ...future(24, 28) })),
    )
    windows.cancel.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceService.cancelMaintenance('u', WS, 'mw1'),
      'DATABASE_ERROR',
    )
    as('requester')
    expectErr(
      await SdStatusMaintenanceService.cancelMaintenance('u', WS, 'mw1'),
      'SD_NOT_AGENT',
    )
  })
})
