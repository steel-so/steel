import { ok, type Result } from '@/src/lib/result'
import {
  addDays,
  listDays,
  localDayOf,
  previousRange,
  ratio,
  resolveAnalyticsRange,
  startOfLocalDay,
} from '@/src/lib/sites/analytics'
import { SiteRepository } from '@/src/repositories/site.repository'
import {
  SiteAnalyticsRepository,
  type SiteAnalyticsWindow,
  type SiteCountRow,
} from '@/src/repositories/site-analytics.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import {
  DEFAULT_SITE_TIMEZONE,
  parseSiteSettings,
} from '@/src/schemas/site.schema'
import type {
  SiteAnalyticsQueryDTO,
  SiteAnalyticsSummaryQueryDTO,
} from '@/src/schemas/site-analytics.schema'
import type {
  SiteAnalyticsCountDTO,
  SiteAnalyticsDTO,
  SiteAnalyticsSummaryDTO,
} from '@/types/site-platform'
import { assertSitesPermission, authorizeSite } from './site-access'

type Values<T extends readonly Promise<Result<unknown>>[]> = {
  -readonly [K in keyof T]: Awaited<T[K]> extends Result<infer V> ? V : never
}

/** Awaits every read and returns the first failure, or all the values. */
async function collect<T extends readonly Promise<Result<unknown>>[]>(
  reads: T,
): Promise<Result<Values<T>>> {
  const results = await Promise.all(reads)
  const failed = results.find((result) => !result.ok)
  if (failed) return failed as Result<never>
  return ok(
    results.map((result) => (result as { value: unknown }).value) as Values<T>,
  )
}

/** Public path of a page as the runtime records it (`/` for the home). */
function recordedPath(page: { path: string; isHome: boolean }): string {
  return page.isHome ? '/' : `/${page.path}`
}

function withLabels(
  rows: SiteCountRow[],
  labels: Map<string, string>,
): SiteAnalyticsCountDTO[] {
  return rows.map((row) => ({
    ...row,
    label: row.key ? (labels.get(row.key) ?? null) : null,
  }))
}

function counts(rows: SiteCountRow[]): SiteAnalyticsCountDTO[] {
  return rows.map((row) => ({ ...row }))
}

/**
 * "Métricas" of the site builder: visits, daily visitors, top pages,
 * referrers, UTM and form conversions per page, read from `site_views`
 * (anonymous: no cookie, a daily server-side hash per visitor). Days are
 * counted in the site's timezone (`settings.timezone`, São Paulo by
 * default).
 */
export const SiteAnalyticsService = {
  async get(
    actorId: string,
    workspaceId: string,
    siteId: string,
    query: SiteAnalyticsQueryDTO,
    now: Date = new Date(),
  ): Promise<Result<SiteAnalyticsDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site

    const timezone =
      parseSiteSettings(site.value.settings).timezone ?? DEFAULT_SITE_TIMEZONE
    const range = resolveAnalyticsRange(query, timezone, now)
    const previous = previousRange(range, timezone)
    const window: SiteAnalyticsWindow = {
      siteId,
      start: range.start,
      end: range.end,
      timezone,
    }

    const all = await collect([
      SiteAnalyticsRepository.daily(window),
      SiteAnalyticsRepository.totals(window),
      SiteAnalyticsRepository.totals({
        ...window,
        start: previous.start,
        end: previous.end,
      }),
      SiteAnalyticsRepository.breakdown(window, 'path'),
      SiteAnalyticsRepository.breakdown(window, 'referrer'),
      SiteAnalyticsRepository.breakdown(window, 'utmSource'),
      SiteAnalyticsRepository.breakdown(window, 'utmMedium'),
      SiteAnalyticsRepository.breakdown(window, 'utmCampaign'),
      SiteAnalyticsRepository.conversionsByPage(window),
      SitePageRepository.listBySite(siteId),
    ] as const)
    if (!all.ok) return all
    const [
      daily,
      totals,
      before,
      pages,
      referrers,
      sources,
      mediums,
      campaigns,
      conversions,
      sitePages,
    ] = all.value

    const titles = new Map(
      sitePages.map((page) => [recordedPath(page), page.title]),
    )
    const byDay = new Map(daily.map((row) => [row.day, row]))

    return ok({
      siteId,
      timezone,
      from: range.from,
      to: range.to,
      totals: {
        ...totals,
        conversionRate: ratio(totals.conversions, totals.views),
      },
      previous: before,
      days: range.days.map((day) => {
        const row = byDay.get(day)
        return {
          date: day,
          views: row?.views ?? 0,
          visitors: row?.visitors ?? 0,
          conversions: row?.conversions ?? 0,
        }
      }),
      topPages: withLabels(pages, titles),
      referrers: counts(referrers),
      utmSources: counts(sources),
      utmMediums: counts(mediums),
      utmCampaigns: counts(campaigns),
      conversionsByPage: conversions.map((row) => ({
        path: row.path,
        label: titles.get(row.path) ?? null,
        views: row.views,
        conversions: row.conversions,
        rate: ratio(row.conversions, row.views),
      })),
    })
  },

  /** Daily views of every site of the workspace over the last `days`
   * days (the sparkline of each card in the sites list). */
  async summary(
    actorId: string,
    workspaceId: string,
    query: SiteAnalyticsSummaryQueryDTO,
    now: Date = new Date(),
  ): Promise<Result<SiteAnalyticsSummaryDTO>> {
    const membership = await assertSitesPermission(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const sites = await SiteRepository.listByWorkspace(workspaceId)
    if (!sites.ok) return sites

    // Each site counts days in its own timezone; the UTC window is padded
    // by a day on both sides and the rows outside [from, to] are dropped.
    const to = localDayOf(now, DEFAULT_SITE_TIMEZONE)
    const from = addDays(to, -(query.days - 1))
    const rows = await SiteAnalyticsRepository.dailyViewsByWorkspace({
      workspaceId,
      from,
      to,
      start: startOfLocalDay(addDays(from, -1), 'UTC'),
      end: startOfLocalDay(addDays(to, 2), 'UTC'),
    })
    if (!rows.ok) return rows

    const days = listDays(from, to)
    const views = new Map<string, Map<string, number>>()
    for (const row of rows.value) {
      const perDay = views.get(row.siteId) ?? new Map<string, number>()
      perDay.set(row.day, row.views)
      views.set(row.siteId, perDay)
    }

    return ok({
      from,
      to,
      sites: sites.value.map((site) => {
        const perDay = views.get(site.id)
        const series = days.map((day) => perDay?.get(day) ?? 0)
        return {
          siteId: site.id,
          views: series,
          total: series.reduce((sum, value) => sum + value, 0),
        }
      }),
    })
  },
}
