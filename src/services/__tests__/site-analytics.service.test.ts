import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSite,
  createFakeSitePage,
} from '@/src/__tests__/factories/site.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/site-page.repository')
vi.mock('@/src/repositories/site-analytics.repository')

import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteAnalyticsRepository } from '@/src/repositories/site-analytics.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { SiteAnalyticsService } from '../site-analytics.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const pages = vi.mocked(SitePageRepository)
const analytics = vi.mocked(SiteAnalyticsRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)

const WS = 'ws1'
const SITE = 'site1'
const NOW = new Date('2026-10-15T15:00:00Z')

function asRole(role: Role) {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  asRole('VIEWER')
  sites.findById.mockResolvedValue(
    ok(
      createFakeSite({
        id: SITE,
        workspaceId: WS,
        settings: { timezone: 'America/Manaus' },
      }),
    ),
  )
  pages.listBySite.mockResolvedValue(
    ok([
      createFakeSitePage({ id: 'home', title: 'Início', isHome: true }),
      createFakeSitePage({ id: 'c', title: 'Contato', path: 'contato' }),
    ]),
  )
  analytics.daily.mockResolvedValue(
    ok([{ day: '2026-10-14', views: 10, visitors: 4, conversions: 1 }]),
  )
  analytics.totals.mockResolvedValueOnce(
    ok({ views: 10, visitors: 4, conversions: 1 }),
  )
  analytics.totals.mockResolvedValueOnce(
    ok({ views: 5, visitors: 2, conversions: 0 }),
  )
  analytics.breakdown.mockImplementation(async (_window, by) =>
    ok(
      by === 'path'
        ? [
            { key: '/', views: 6, visitors: 3 },
            { key: '/contato', views: 3, visitors: 2 },
            { key: '/antiga', views: 1, visitors: 1 },
            { key: null, views: 1, visitors: 1 },
          ]
        : by === 'referrer'
          ? [{ key: null, views: 7, visitors: 3 }]
          : [{ key: by, views: 1, visitors: 1 }],
    ),
  )
  analytics.conversionsByPage.mockResolvedValue(
    ok([
      { path: '/contato', pageId: 'c', views: 3, conversions: 1 },
      { path: '/sumiu', pageId: null, views: 0, conversions: 1 },
    ]),
  )
})

describe('SiteAnalyticsService.get', () => {
  it('blocks non-members, a disabled module and other workspaces', async () => {
    membership.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await SiteAnalyticsService.get('u1', WS, SITE, {}, NOW),
      'FORBIDDEN',
    )
    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(
      await SiteAnalyticsService.get('u1', WS, SITE, {}, NOW),
      'MODULE_DISABLED',
    )
    sites.findById.mockResolvedValueOnce(err(appError('SITE_NOT_FOUND', 'x')))
    expectErr(
      await SiteAnalyticsService.get('u1', 'other', SITE, {}, NOW),
      'SITE_NOT_FOUND',
    )
    expect(analytics.daily).not.toHaveBeenCalled()
  })

  it('aggregates the range in the site timezone, filling empty days', async () => {
    const result = expectOk(
      await SiteAnalyticsService.get(
        'u1',
        WS,
        SITE,
        { from: '2026-10-13', to: '2026-10-15' },
        NOW,
      ),
    )
    expect(result.timezone).toBe('America/Manaus')
    expect(result.days).toEqual([
      { date: '2026-10-13', views: 0, visitors: 0, conversions: 0 },
      { date: '2026-10-14', views: 10, visitors: 4, conversions: 1 },
      { date: '2026-10-15', views: 0, visitors: 0, conversions: 0 },
    ])
    expect(result.totals).toEqual({
      views: 10,
      visitors: 4,
      conversions: 1,
      conversionRate: 0.1,
    })
    expect(result.previous).toEqual({ views: 5, visitors: 2, conversions: 0 })
    expect(result.topPages.map((row) => row.label)).toEqual([
      'Início',
      'Contato',
      null,
      null,
    ])
    expect(result.referrers).toEqual([{ key: null, views: 7, visitors: 3 }])
    expect(result.utmSources[0].key).toBe('utmSource')
    expect(result.utmMediums[0].key).toBe('utmMedium')
    expect(result.utmCampaigns[0].key).toBe('utmCampaign')
    expect(result.conversionsByPage).toEqual([
      {
        path: '/contato',
        label: 'Contato',
        views: 3,
        conversions: 1,
        rate: 0.3333,
      },
      { path: '/sumiu', label: null, views: 0, conversions: 1, rate: 0 },
    ])

    // Manaus is UTC-4: the window starts at 04:00 UTC.
    const window = analytics.daily.mock.calls[0][0]
    expect(window.start.toISOString()).toBe('2026-10-13T04:00:00.000Z')
    expect(window.end.toISOString()).toBe('2026-10-16T04:00:00.000Z')
    const previous = analytics.totals.mock.calls[1][0]
    expect(previous.start.toISOString()).toBe('2026-10-10T04:00:00.000Z')
  })

  it('defaults to the last 30 days in São Paulo time', async () => {
    sites.findById.mockResolvedValueOnce(
      ok(createFakeSite({ id: SITE, workspaceId: WS })),
    )
    const result = expectOk(await SiteAnalyticsService.get('u1', WS, SITE, {}))
    expect(result.timezone).toBe('America/Sao_Paulo')
    expect(result.days).toHaveLength(30)
  })

  it('returns the first failing read', async () => {
    analytics.breakdown.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteAnalyticsService.get('u1', WS, SITE, {}, NOW),
      'DATABASE_ERROR',
    )
  })
})

describe('SiteAnalyticsService.summary', () => {
  it('builds one daily series per site', async () => {
    sites.listByWorkspace.mockResolvedValue(
      ok([
        { ...createFakeSite({ id: 'a' }), _count: { pages: 1 } },
        { ...createFakeSite({ id: 'b' }), _count: { pages: 2 } },
      ]),
    )
    analytics.dailyViewsByWorkspace.mockResolvedValue(
      ok([
        { siteId: 'a', day: '2026-10-15', views: 3 },
        { siteId: 'a', day: '2026-10-09', views: 2 },
      ]),
    )
    const summary = expectOk(
      await SiteAnalyticsService.summary('u1', WS, { days: 7 }, NOW),
    )
    expect(summary.from).toBe('2026-10-09')
    expect(summary.to).toBe('2026-10-15')
    expect(summary.sites).toEqual([
      { siteId: 'a', views: [2, 0, 0, 0, 0, 0, 3], total: 5 },
      { siteId: 'b', views: [0, 0, 0, 0, 0, 0, 0], total: 0 },
    ])
    const input = analytics.dailyViewsByWorkspace.mock.calls[0][0]
    expect(input).toMatchObject({ workspaceId: WS, from: '2026-10-09' })
    expect(input.start.toISOString()).toBe('2026-10-08T00:00:00.000Z')
    expect(input.end.toISOString()).toBe('2026-10-17T00:00:00.000Z')
    expectOk(await SiteAnalyticsService.summary('u1', WS, { days: 7 }))
  })

  it('checks access and propagates failures', async () => {
    membership.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await SiteAnalyticsService.summary('u1', WS, { days: 14 }, NOW),
      'FORBIDDEN',
    )
    sites.listByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteAnalyticsService.summary('u1', WS, { days: 14 }, NOW),
      'DATABASE_ERROR',
    )
    sites.listByWorkspace.mockResolvedValueOnce(ok([]))
    analytics.dailyViewsByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteAnalyticsService.summary('u1', WS, { days: 14 }, NOW),
      'DATABASE_ERROR',
    )
  })
})
