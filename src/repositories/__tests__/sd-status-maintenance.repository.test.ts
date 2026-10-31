import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedSdStatusPage } from '@/src/__tests__/factories/nov-s2-major-incident.factory'
import { seedSdStatusMaintenance } from '@/src/__tests__/factories/nov-sd-followups.factory'
import { seedSdConfigItem } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SdStatusComponentRepository as Components } from '../sd-status-component.repository'
import { SdStatusMaintenanceRepository as Repo } from '../sd-status-maintenance.repository'

// The status tables have no foreign key to the workspace, so the global
// TRUNCATE ... CASCADE does not reach them: clean them here.
afterEach(async () => {
  vi.restoreAllMocks()
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE sd_status_pages, sd_status_maintenances CASCADE',
  )
})

const HOUR = 3_600_000

const input = (overrides = {}) => ({
  title: 'Troca do switch',
  description: null,
  startsAt: new Date(Date.now() + HOUR),
  endsAt: new Date(Date.now() + 2 * HOUR),
  suppressMonitoring: false,
  configItemIds: [] as string[],
  notifySubscribers: true,
  ...overrides,
})

describe('SdStatusMaintenanceRepository', () => {
  it('creates a window with its pages and finds it by workspace', async () => {
    const workspace = await seedWorkspace()
    const page = await seedSdStatusPage(workspace.id)
    const created = expectOk(
      await Repo.create(workspace.id, {
        ...input(),
        pageIds: [page.id],
        createdById: 'u',
      }),
    )
    expect(created.pages.map((p) => p.page.id)).toEqual([page.id])
    expect(expectOk(await Repo.findById(created.id, workspace.id)).title).toBe(
      'Troca do switch',
    )
    expectErr(
      await Repo.findById(created.id, 'other-workspace'),
      'SD_MAINTENANCE_NOT_FOUND',
    )
    expect(expectOk(await Repo.findByIdAny(created.id))?.id).toBe(created.id)
    expect(expectOk(await Repo.findByIdAny('nope'))).toBeNull()
  })

  it('lists windows that end after the cut-off, soonest first', async () => {
    const workspace = await seedWorkspace()
    const page = await seedSdStatusPage(workspace.id)
    const later = await seedSdStatusMaintenance(workspace.id, [page.id], {
      title: 'Depois',
      startsAt: new Date(Date.now() + 5 * HOUR),
      endsAt: new Date(Date.now() + 6 * HOUR),
    })
    const sooner = await seedSdStatusMaintenance(workspace.id, [page.id], {
      title: 'Antes',
    })
    await seedSdStatusMaintenance(workspace.id, [page.id], {
      title: 'Velha',
      startsAt: new Date(Date.now() - 30 * 24 * HOUR),
      endsAt: new Date(Date.now() - 29 * 24 * HOUR),
    })
    const other = await seedWorkspace()
    await seedSdStatusMaintenance(other.id, [])
    const rows = expectOk(
      await Repo.list(workspace.id, new Date(Date.now() - 7 * 24 * HOUR)),
    )
    expect(rows.map((r) => r.id)).toEqual([sooner.id, later.id])
  })

  it('updates the fields and replaces the pages', async () => {
    const workspace = await seedWorkspace()
    const p1 = await seedSdStatusPage(workspace.id)
    const p2 = await seedSdStatusPage(workspace.id)
    const window = await seedSdStatusMaintenance(workspace.id, [p1.id], {
      announcedAt: new Date(),
    })
    const updated = expectOk(
      await Repo.update(window.id, workspace.id, {
        title: 'Outro',
        pageIds: [p2.id],
        resetAnnouncement: true,
      }),
    )
    expect(updated.title).toBe('Outro')
    expect(updated.announcedAt).toBeNull()
    expect(updated.pages.map((p) => p.page.id)).toEqual([p2.id])
    const kept = expectOk(
      await Repo.update(window.id, workspace.id, { title: 'Mais um' }),
    )
    expect(kept.pages).toHaveLength(1)
    expectErr(
      await Repo.update(window.id, 'other', { title: 'x' }),
      'SD_MAINTENANCE_NOT_FOUND',
    )
  })

  it('cancels once', async () => {
    const workspace = await seedWorkspace()
    const window = await seedSdStatusMaintenance(workspace.id, [])
    const at = new Date()
    expect(
      expectOk(await Repo.cancel(window.id, workspace.id, at)).canceledAt,
    ).toEqual(at)
    expectErr(
      await Repo.cancel(window.id, workspace.id, at),
      'SD_MAINTENANCE_NOT_FOUND',
    )
  })

  it('finds the window that suppresses an item right now', async () => {
    const workspace = await seedWorkspace()
    const user = await seedUser()
    const item = await seedSdConfigItem(workspace.id, user.id)
    const now = new Date()
    const running = {
      startsAt: new Date(now.getTime() - HOUR),
      endsAt: new Date(now.getTime() + HOUR),
      suppressMonitoring: true,
      configItemIds: [item.id],
    }
    expect(
      expectOk(await Repo.findSuppressing(workspace.id, item.id, now)),
    ).toBeNull()

    await seedSdStatusMaintenance(workspace.id, [], {
      ...running,
      suppressMonitoring: false,
    })
    await seedSdStatusMaintenance(workspace.id, [], {
      ...running,
      canceledAt: new Date(),
    })
    await seedSdStatusMaintenance(workspace.id, [], {
      ...running,
      startsAt: new Date(now.getTime() + HOUR),
      endsAt: new Date(now.getTime() + 2 * HOUR),
    })
    await seedSdStatusMaintenance(workspace.id, [], {
      ...running,
      configItemIds: ['another'],
    })
    expect(
      expectOk(await Repo.findSuppressing(workspace.id, item.id, now)),
    ).toBeNull()

    const match = await seedSdStatusMaintenance(workspace.id, [], running)
    expect(
      expectOk(await Repo.findSuppressing(workspace.id, item.id, now))?.id,
    ).toBe(match.id)
    expect(
      expectOk(await Repo.findSuppressing('other', item.id, now)),
    ).toBeNull()
  })

  it('lists what a public page shows: not canceled, not over, inside the look-ahead', async () => {
    const workspace = await seedWorkspace()
    const page = await seedSdStatusPage(workspace.id)
    const otherPage = await seedSdStatusPage(workspace.id)
    const now = new Date()
    const show = await seedSdStatusMaintenance(workspace.id, [page.id])
    await seedSdStatusMaintenance(workspace.id, [page.id], {
      canceledAt: new Date(),
    })
    await seedSdStatusMaintenance(workspace.id, [page.id], {
      startsAt: new Date(now.getTime() - 5 * HOUR),
      endsAt: new Date(now.getTime() - 4 * HOUR),
    })
    await seedSdStatusMaintenance(workspace.id, [page.id], {
      startsAt: new Date(now.getTime() + 30 * 24 * HOUR),
      endsAt: new Date(now.getTime() + 31 * 24 * HOUR),
    })
    await seedSdStatusMaintenance(workspace.id, [otherPage.id])
    const rows = expectOk(
      await Repo.listForPage(
        page.id,
        now,
        new Date(now.getTime() + 14 * 24 * HOUR),
      ),
    )
    expect(rows.map((r) => r.id)).toEqual([show.id])
  })

  it('claims each notice once', async () => {
    const workspace = await seedWorkspace()
    const window = await seedSdStatusMaintenance(workspace.id, [])
    const at = new Date()
    expect(expectOk(await Repo.claimNotice(window.id, 'scheduled', at))).toBe(
      true,
    )
    expect(expectOk(await Repo.claimNotice(window.id, 'scheduled', at))).toBe(
      false,
    )
    // A cancellation notice needs the window to be canceled.
    expect(expectOk(await Repo.claimNotice(window.id, 'canceled', at))).toBe(
      false,
    )
    await Repo.cancel(window.id, workspace.id, at)
    expect(expectOk(await Repo.claimNotice(window.id, 'canceled', at))).toBe(
      true,
    )
    expect(expectOk(await Repo.claimNotice(window.id, 'canceled', at))).toBe(
      false,
    )

    const canceledEarly = await seedSdStatusMaintenance(workspace.id, [], {
      canceledAt: new Date(),
    })
    expect(
      expectOk(await Repo.claimNotice(canceledEarly.id, 'scheduled', at)),
    ).toBe(false)
  })

  it('stores the delivery counts', async () => {
    const workspace = await seedWorkspace()
    const window = await seedSdStatusMaintenance(workspace.id, [])
    expectOk(
      await Repo.finishNotice(window.id, { total: 4, sent: 3, failed: 1 }),
    )
    const row = expectOk(await Repo.findById(window.id, workspace.id))
    expect([row.notifyTotal, row.notifySent, row.notifyFailed]).toEqual([
      4, 3, 1,
    ])
  })

  it('names the config items of the workspace and ignores the deleted ones', async () => {
    const workspace = await seedWorkspace()
    const other = await seedWorkspace()
    const user = await seedUser()
    const a = await seedSdConfigItem(workspace.id, user.id, { name: 'A' })
    const gone = await seedSdConfigItem(workspace.id, user.id, {
      name: 'B',
      deletedAt: new Date(),
    })
    const foreign = await seedSdConfigItem(other.id, user.id, { name: 'C' })
    const names = expectOk(
      await Repo.findConfigItemNames(workspace.id, [a.id, gone.id, foreign.id]),
    )
    expect([...names.entries()]).toEqual([[a.id, 'A']])
    expect(
      expectOk(await Repo.findConfigItemNames(workspace.id, [])).size,
    ).toBe(0)
  })

  it('turns database failures into errors', async () => {
    vi.spyOn(prisma.sdStatusMaintenance, 'findFirst').mockRejectedValue(
      new Error('down'),
    )
    expectErr(await Repo.findById('x', 'w'), 'DATABASE_ERROR')
    expectErr(
      await Repo.findSuppressing('w', 'c', new Date()),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.sdStatusMaintenance, 'findUnique').mockRejectedValue(
      new Error('down'),
    )
    expectErr(await Repo.findByIdAny('x'), 'DATABASE_ERROR')
    vi.spyOn(prisma.sdStatusMaintenance, 'findMany').mockRejectedValue(
      new Error('down'),
    )
    expectErr(await Repo.list('w', new Date()), 'DATABASE_ERROR')
    expectErr(
      await Repo.listForPage('p', new Date(), new Date()),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.sdStatusMaintenance, 'create').mockRejectedValue(
      new Error('down'),
    )
    expectErr(
      await Repo.create('w', { ...input(), pageIds: [], createdById: 'u' }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.sdStatusMaintenance, 'updateMany').mockRejectedValue(
      new Error('down'),
    )
    expectErr(await Repo.update('x', 'w', { title: 't' }), 'DATABASE_ERROR')
    expectErr(await Repo.cancel('x', 'w', new Date()), 'DATABASE_ERROR')
    expectErr(
      await Repo.claimNotice('x', 'scheduled', new Date()),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.sdStatusMaintenance, 'update').mockRejectedValue(
      new Error('down'),
    )
    expectErr(
      await Repo.finishNotice('x', { total: 0, sent: 0, failed: 0 }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.sdConfigItem, 'findMany').mockRejectedValue(
      new Error('down'),
    )
    expectErr(await Repo.findConfigItemNames('w', ['a']), 'DATABASE_ERROR')
  })
})

describe('SdStatusComponentRepository', () => {
  it('creates components in order and lists them by page', async () => {
    const workspace = await seedWorkspace()
    const page = await seedSdStatusPage(workspace.id)
    const other = await seedSdStatusPage(workspace.id)
    const make = (pageId: string, name: string) =>
      Components.create({
        workspaceId: workspace.id,
        pageId,
        name,
        serviceId: null,
        state: 'OPERATIONAL',
      })
    const a = expectOk(await make(page.id, 'A'))
    const b = expectOk(await make(page.id, 'B'))
    expectOk(await make(other.id, 'Z'))
    expect([a.position, b.position]).toEqual([0, 1])
    const rows = expectOk(await Components.listByPage(page.id, workspace.id))
    expect(rows.map((r) => r.name)).toEqual(['A', 'B'])
    expect(
      expectOk(await Components.listByPage(page.id, 'other-workspace')),
    ).toEqual([])
  })

  it('stamps the state change only when the state actually changes', async () => {
    const workspace = await seedWorkspace()
    const page = await seedSdStatusPage(workspace.id)
    const created = expectOk(
      await Components.create({
        workspaceId: workspace.id,
        pageId: page.id,
        name: 'A',
        serviceId: 's1',
        state: 'OPERATIONAL',
      }),
    )
    const renamed = expectOk(
      await Components.update(created.id, page.id, workspace.id, {
        name: 'Renomeado',
      }),
    )
    expect(renamed.stateChangedAt).toEqual(created.stateChangedAt)
    const degraded = expectOk(
      await Components.update(created.id, page.id, workspace.id, {
        state: 'DEGRADED',
      }),
    )
    expect(degraded.state).toBe('DEGRADED')
    expect(degraded.stateChangedAt.getTime()).toBeGreaterThan(
      created.stateChangedAt.getTime(),
    )
    const same = expectOk(
      await Components.update(created.id, page.id, workspace.id, {
        state: 'DEGRADED',
      }),
    )
    expect(same.stateChangedAt).toEqual(degraded.stateChangedAt)
    expectErr(
      await Components.update(created.id, page.id, 'other', { name: 'x' }),
      'SD_STATUS_COMPONENT_NOT_FOUND',
    )
  })

  it('removes within the page and workspace only', async () => {
    const workspace = await seedWorkspace()
    const page = await seedSdStatusPage(workspace.id)
    const created = expectOk(
      await Components.create({
        workspaceId: workspace.id,
        pageId: page.id,
        name: 'A',
        serviceId: null,
        state: 'OUTAGE',
      }),
    )
    expectErr(
      await Components.remove(created.id, page.id, 'other'),
      'SD_STATUS_COMPONENT_NOT_FOUND',
    )
    expectOk(await Components.remove(created.id, page.id, workspace.id))
    expectErr(
      await Components.remove(created.id, page.id, workspace.id),
      'SD_STATUS_COMPONENT_NOT_FOUND',
    )
  })

  it('turns database failures into errors', async () => {
    vi.spyOn(prisma.sdStatusComponent, 'findMany').mockRejectedValue(
      new Error('down'),
    )
    expectErr(await Components.listByPage('p', 'w'), 'DATABASE_ERROR')
    vi.spyOn(prisma.sdStatusComponent, 'aggregate').mockRejectedValue(
      new Error('down'),
    )
    expectErr(
      await Components.create({
        workspaceId: 'w',
        pageId: 'p',
        name: 'A',
        serviceId: null,
        state: 'OPERATIONAL',
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.sdStatusComponent, 'findFirst').mockRejectedValue(
      new Error('down'),
    )
    expectErr(
      await Components.update('c', 'p', 'w', { name: 'x' }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.sdStatusComponent, 'deleteMany').mockRejectedValue(
      new Error('down'),
    )
    expectErr(await Components.remove('c', 'p', 'w'), 'DATABASE_ERROR')
  })
})
