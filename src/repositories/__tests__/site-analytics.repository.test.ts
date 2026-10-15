import { describe, expect, it, vi } from 'vitest'
import { seedSite } from '@/src/__tests__/factories/site.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SiteAnalyticsRepository } from '../site-analytics.repository'

const TZ = 'America/Sao_Paulo'

async function view(
  siteId: string,
  at: string,
  data: Partial<{
    path: string
    visitorHash: string
    referrer: string | null
    utmSource: string
    utmMedium: string
    utmCampaign: string
    kind: 'VIEW' | 'CONVERSION'
    formToken: string
    pageId: string
  }> = {},
) {
  await prisma.siteView.create({
    data: {
      siteId,
      path: '/',
      visitorHash: 'v1',
      createdAt: new Date(at),
      ...data,
    },
  })
}

async function fixture() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const site = await seedSite(workspace.id, user.id)
  const other = await seedSite(workspace.id, user.id)
  // 14/10 in São Paulo (UTC-3): 03:00Z up to 03:00Z of the 15th.
  await view(site.id, '2026-10-14T12:00:00Z', { utmSource: 'ig' })
  await view(site.id, '2026-10-14T13:00:00Z', {
    visitorHash: 'v2',
    referrer: 'www.google.com',
    utmSource: 'ig',
    utmMedium: 'social',
    utmCampaign: 'out',
  })
  await view(site.id, '2026-10-14T14:00:00Z', {
    path: '/contato',
    pageId: 'c',
  })
  await view(site.id, '2026-10-14T14:05:00Z', {
    path: '/contato',
    kind: 'CONVERSION',
    formToken: 'tok',
  })
  // 02:00Z of the 15th is still the 14th in São Paulo.
  await view(site.id, '2026-10-15T02:00:00Z', { visitorHash: 'v3' })
  await view(site.id, '2026-10-15T12:00:00Z')
  // Outside the window and on another site.
  await view(site.id, '2026-10-10T12:00:00Z')
  await view(other.id, '2026-10-14T12:00:00Z')
  return { workspace, site, other }
}

const windowOf = (siteId: string) => ({
  siteId,
  start: new Date('2026-10-14T03:00:00Z'),
  end: new Date('2026-10-16T03:00:00Z'),
  timezone: TZ,
})

describe('SiteAnalyticsRepository', () => {
  it('counts views, daily visitors and conversions per local day', async () => {
    const { site } = await fixture()
    const window = windowOf(site.id)

    expect(expectOk(await SiteAnalyticsRepository.daily(window))).toEqual([
      { day: '2026-10-14', views: 4, visitors: 3, conversions: 1 },
      { day: '2026-10-15', views: 1, visitors: 1, conversions: 0 },
    ])
    expect(expectOk(await SiteAnalyticsRepository.totals(window))).toEqual({
      views: 5,
      visitors: 4,
      conversions: 1,
    })
    const empty = expectOk(
      await SiteAnalyticsRepository.totals({
        ...window,
        start: new Date('2020-01-01T00:00:00Z'),
        end: new Date('2020-01-02T00:00:00Z'),
      }),
    )
    expect(empty).toEqual({ views: 0, visitors: 0, conversions: 0 })
  })

  it('breaks views down by page, referrer and UTM', async () => {
    const { site } = await fixture()
    const window = windowOf(site.id)
    expect(
      expectOk(await SiteAnalyticsRepository.breakdown(window, 'path')),
    ).toEqual([
      { key: '/', views: 4, visitors: 4 },
      { key: '/contato', views: 1, visitors: 1 },
    ])
    expect(
      expectOk(await SiteAnalyticsRepository.breakdown(window, 'referrer')),
    ).toEqual([
      { key: null, views: 4, visitors: 3 },
      { key: 'www.google.com', views: 1, visitors: 1 },
    ])
    expect(
      expectOk(await SiteAnalyticsRepository.breakdown(window, 'utmSource')),
    ).toEqual([{ key: 'ig', views: 2, visitors: 2 }])
    expect(
      expectOk(await SiteAnalyticsRepository.breakdown(window, 'utmMedium', 1)),
    ).toEqual([{ key: 'social', views: 1, visitors: 1 }])
    expect(
      expectOk(await SiteAnalyticsRepository.breakdown(window, 'utmCampaign')),
    ).toHaveLength(1)
  })

  it('lists conversions per page', async () => {
    const { site } = await fixture()
    expect(
      expectOk(
        await SiteAnalyticsRepository.conversionsByPage(windowOf(site.id)),
      ),
    ).toEqual([{ path: '/contato', pageId: 'c', views: 1, conversions: 1 }])
  })

  it('reads daily views of every live site of the workspace in its timezone', async () => {
    const { workspace, site, other } = await fixture()
    // `other` counts days in UTC: its view at 12:00Z stays on the 14th too.
    await prisma.site.update({
      where: { id: other.id },
      data: { settings: { timezone: 'UTC' } },
    })
    const deleted = await seedSite(workspace.id, site.createdById, {
      deletedAt: new Date(),
    })
    await view(deleted.id, '2026-10-14T12:00:00Z')

    const rows = expectOk(
      await SiteAnalyticsRepository.dailyViewsByWorkspace({
        workspaceId: workspace.id,
        from: '2026-10-14',
        to: '2026-10-15',
        start: new Date('2026-10-13T00:00:00Z'),
        end: new Date('2026-10-17T00:00:00Z'),
      }),
    )
    expect(rows).toEqual(
      expect.arrayContaining([
        { siteId: site.id, day: '2026-10-14', views: 4 },
        { siteId: site.id, day: '2026-10-15', views: 1 },
        { siteId: other.id, day: '2026-10-14', views: 1 },
      ]),
    )
    expect(rows).toHaveLength(3)
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const spy = vi
      .spyOn(prisma, '$queryRaw')
      .mockImplementation((() => Promise.reject(new Error('boom'))) as never)
    const window = windowOf('s')
    const results = await Promise.all([
      SiteAnalyticsRepository.daily(window),
      SiteAnalyticsRepository.totals(window),
      SiteAnalyticsRepository.breakdown(window, 'path'),
      SiteAnalyticsRepository.conversionsByPage(window),
      SiteAnalyticsRepository.dailyViewsByWorkspace({
        workspaceId: 'w',
        from: '2026-10-01',
        to: '2026-10-02',
        start: new Date(),
        end: new Date(),
      }),
    ])
    for (const result of results) expectErr(result, 'DATABASE_ERROR')
    spy.mockRestore()
  })
})
