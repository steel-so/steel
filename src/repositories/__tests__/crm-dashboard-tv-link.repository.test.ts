import { describe, expect, it, vi } from 'vitest'
import {
  seedCrmDashboard,
  seedCrmDashboardWidget,
} from '@/src/__tests__/factories/crm-dashboard.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  CrmDashboardRepository,
  CrmDashboardWidgetRepository,
  CrmDashboardTvLinkRepository as links,
} from '../crm-dashboard.repository'

async function dashboard() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const created = await seedCrmDashboard(workspace.id, user.id)
  return { workspace, user, dashboard: created }
}

describe('CrmDashboardTvLinkRepository', () => {
  it('creates, finds by token, touches and revokes a link', async () => {
    const { workspace, user, dashboard: d } = await dashboard()
    const link = expectOk(
      await links.create({
        workspaceId: workspace.id,
        dashboardId: d.id,
        token: 'token-123',
        name: 'TV',
        createdById: user.id,
      }),
    )

    const found = expectOk(await links.findByToken('token-123'))
    expect(found.dashboard.id).toBe(d.id)
    expect(expectOk(await links.findById(link.id, d.id)).name).toBe('TV')
    expect(expectOk(await links.listByDashboard(d.id))).toHaveLength(1)

    const at = new Date('2026-10-15T15:00:00.000Z')
    expectOk(await links.touch(link.id, at))
    expect(expectOk(await links.findById(link.id, d.id)).lastUsedAt).toEqual(at)

    expectOk(await links.revoke(link.id))
    expectErr(await links.findByToken('token-123'), 'CRM_TV_LINK_NOT_FOUND')
    expectErr(await links.findById(link.id, d.id), 'CRM_TV_LINK_NOT_FOUND')
    expect(expectOk(await links.listByDashboard(d.id))).toEqual([])
  })

  it('does not find a link through another dashboard', async () => {
    const { workspace, user, dashboard: d } = await dashboard()
    const link = expectOk(
      await links.create({
        workspaceId: workspace.id,
        dashboardId: d.id,
        token: 'token-xyz',
        name: 'TV',
        createdById: user.id,
      }),
    )
    expectErr(await links.findById(link.id, 'other'), 'CRM_TV_LINK_NOT_FOUND')
  })

  it('returns DATABASE_ERROR when Prisma fails', async () => {
    expectErr(await links.revoke('missing'), 'DATABASE_ERROR')
    expectErr(await links.touch('missing', new Date()), 'DATABASE_ERROR')
    expectErr(
      await links.create({
        workspaceId: 'ws',
        dashboardId: 'missing',
        token: 't',
        name: 'TV',
        createdById: 'u',
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmDashboardTvLink, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(await links.listByDashboard('d'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmDashboardTvLink, 'findFirst').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(await links.findById('l', 'd'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmDashboardTvLink, 'findFirst').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(await links.findByToken('t'), 'DATABASE_ERROR')
  })
})

describe('dashboard screens', () => {
  it('stores settings and widget pages, ordered by screen', async () => {
    const { workspace, user, dashboard: d } = await dashboard()
    const created = expectOk(
      await CrmDashboardRepository.create({
        workspaceId: workspace.id,
        createdById: user.id,
        title: 'TV',
        module: 'CRM',
        settings: { pages: ['A', 'B'], rotateSeconds: 30 },
      }),
    )
    expect(created.settings).toEqual({ pages: ['A', 'B'], rotateSeconds: 30 })
    const updated = expectOk(
      await CrmDashboardRepository.update(created.id, {
        settings: { pages: ['A'], rotateSeconds: 0 },
      }),
    )
    expect(updated.settings).toEqual({ pages: ['A'], rotateSeconds: 0 })

    const second = await seedCrmDashboardWidget(d.id, { page: 1, y: 0 })
    const first = await seedCrmDashboardWidget(d.id, { page: 0, y: 5 })
    const list = expectOk(
      await CrmDashboardWidgetRepository.listByDashboard(d.id),
    )
    expect(list.map((w) => w.id)).toEqual([first.id, second.id])

    expectOk(
      await CrmDashboardWidgetRepository.applyLayout(d.id, [
        { id: first.id, x: 0, y: 0, w: 4, h: 4, page: 2 },
        { id: second.id, x: 1, y: 1, w: 4, h: 4 },
      ]),
    )
    const moved = expectOk(
      await CrmDashboardWidgetRepository.listByDashboard(d.id),
    )
    expect(moved.map((w) => [w.id, w.page])).toEqual([
      [second.id, 1],
      [first.id, 2],
    ])
  })
})
