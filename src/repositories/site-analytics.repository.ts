import { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { DEFAULT_SITE_TIMEZONE } from '@/src/schemas/site.schema'
import { dbError } from './db-error'

/**
 * Aggregates over `site_views` (page views and form conversions of the
 * public runtime). Days are counted in the caller's timezone; the window
 * is `[start, end)` in UTC. The visitor hash rotates daily (see
 * `siteVisitorHash`), so "visitors" are distinct per day.
 */

export interface SiteAnalyticsWindow {
  siteId: string
  start: Date
  end: Date
  timezone: string
}

export interface SiteDailyRow {
  day: string
  views: number
  visitors: number
  conversions: number
}

export interface SiteCountRow {
  key: string | null
  views: number
  visitors: number
}

export interface SiteConversionRow {
  path: string
  pageId: string | null
  views: number
  conversions: number
}

export interface SiteTotalsRow {
  views: number
  visitors: number
  conversions: number
}

/** Columns a breakdown may group by (never interpolate anything else). */
const BREAKDOWN_COLUMNS = {
  path: 'path',
  referrer: 'referrer',
  utmSource: 'utm_source',
  utmMedium: 'utm_medium',
  utmCampaign: 'utm_campaign',
} as const

export type SiteBreakdown = keyof typeof BREAKDOWN_COLUMNS

const num = (value: unknown) => Number(value ?? 0)

function localDay(timezone: string) {
  return Prisma.sql`to_char((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}, 'YYYY-MM-DD')`
}

export const SiteAnalyticsRepository = {
  async daily(window: SiteAnalyticsWindow): Promise<Result<SiteDailyRow[]>> {
    try {
      const rows = await prisma.$queryRaw<
        Array<{
          day: string
          views: bigint
          visitors: bigint
          conversions: bigint
        }>
      >(Prisma.sql`
        SELECT ${localDay(window.timezone)} AS day,
          count(*) FILTER (WHERE kind = 'VIEW') AS views,
          count(DISTINCT visitor_hash) FILTER (WHERE kind = 'VIEW') AS visitors,
          count(*) FILTER (WHERE kind = 'CONVERSION') AS conversions
        FROM site_views
        WHERE site_id = ${window.siteId}
          AND created_at >= ${window.start} AND created_at < ${window.end}
        GROUP BY day
        ORDER BY day`)
      return ok(
        rows.map((row) => ({
          day: row.day,
          views: num(row.views),
          visitors: num(row.visitors),
          conversions: num(row.conversions),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to read site daily metrics', error))
    }
  },

  /** Views and distinct daily visitors grouped by one column (page,
   * referrer, UTM), most viewed first. Rows without a UTM value are left
   * out of UTM breakdowns; a missing referrer is "direct" (`null`). */
  async breakdown(
    window: SiteAnalyticsWindow,
    by: SiteBreakdown,
    limit = 10,
  ): Promise<Result<SiteCountRow[]>> {
    const column = Prisma.raw(BREAKDOWN_COLUMNS[by])
    const skipEmpty = by.startsWith('utm')
      ? Prisma.sql`AND ${column} IS NOT NULL`
      : Prisma.empty
    try {
      const rows = await prisma.$queryRaw<
        Array<{ key: string | null; views: bigint; visitors: bigint }>
      >(Prisma.sql`
        SELECT ${column} AS key,
          count(*) AS views,
          count(DISTINCT (${localDay(window.timezone)}, visitor_hash)) AS visitors
        FROM site_views
        WHERE site_id = ${window.siteId} AND kind = 'VIEW'
          AND created_at >= ${window.start} AND created_at < ${window.end}
          ${skipEmpty}
        GROUP BY ${column}
        ORDER BY views DESC, key ASC NULLS FIRST
        LIMIT ${limit}`)
      return ok(
        rows.map((row) => ({
          key: row.key,
          views: num(row.views),
          visitors: num(row.visitors),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to read site metrics breakdown', error))
    }
  },

  /** Views and conversions per page, pages with conversions first. */
  async conversionsByPage(
    window: SiteAnalyticsWindow,
    limit = 10,
  ): Promise<Result<SiteConversionRow[]>> {
    try {
      const rows = await prisma.$queryRaw<
        Array<{
          path: string
          page_id: string | null
          views: bigint
          conversions: bigint
        }>
      >(Prisma.sql`
        SELECT path, max(page_id) AS page_id,
          count(*) FILTER (WHERE kind = 'VIEW') AS views,
          count(*) FILTER (WHERE kind = 'CONVERSION') AS conversions
        FROM site_views
        WHERE site_id = ${window.siteId}
          AND created_at >= ${window.start} AND created_at < ${window.end}
        GROUP BY path
        HAVING count(*) FILTER (WHERE kind = 'CONVERSION') > 0
        ORDER BY conversions DESC, views DESC, path ASC
        LIMIT ${limit}`)
      return ok(
        rows.map((row) => ({
          path: row.path,
          pageId: row.page_id,
          views: num(row.views),
          conversions: num(row.conversions),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to read site conversions', error))
    }
  },

  async totals(window: SiteAnalyticsWindow): Promise<Result<SiteTotalsRow>> {
    try {
      const [row] = await prisma.$queryRaw<
        Array<{ views: bigint; visitors: bigint; conversions: bigint }>
      >(Prisma.sql`
        SELECT count(*) FILTER (WHERE kind = 'VIEW') AS views,
          count(DISTINCT (${localDay(window.timezone)}, visitor_hash))
            FILTER (WHERE kind = 'VIEW') AS visitors,
          count(*) FILTER (WHERE kind = 'CONVERSION') AS conversions
        FROM site_views
        WHERE site_id = ${window.siteId}
          AND created_at >= ${window.start} AND created_at < ${window.end}`)
      return ok({
        views: num(row?.views),
        visitors: num(row?.visitors),
        conversions: num(row?.conversions),
      })
    } catch (error) {
      return err(dbError('Failed to read site metric totals', error))
    }
  },

  /** Daily views of every live (not deleted) site of a workspace, each in
   * its own timezone, between two local days (both included). */
  async dailyViewsByWorkspace(input: {
    workspaceId: string
    from: string
    to: string
    start: Date
    end: Date
  }): Promise<Result<Array<{ siteId: string; day: string; views: number }>>> {
    try {
      const rows = await prisma.$queryRaw<
        Array<{ site_id: string; day: string; views: bigint }>
      >(Prisma.sql`
        SELECT v.site_id,
          to_char((v.created_at AT TIME ZONE 'UTC') AT TIME ZONE
            COALESCE(NULLIF(s.settings->>'timezone', ''), ${DEFAULT_SITE_TIMEZONE}),
            'YYYY-MM-DD') AS day,
          count(*) AS views
        FROM site_views v
        JOIN sites s ON s.id = v.site_id
        WHERE s.workspace_id = ${input.workspaceId} AND s.deleted_at IS NULL
          AND v.kind = 'VIEW'
          AND v.created_at >= ${input.start} AND v.created_at < ${input.end}
        GROUP BY v.site_id, day
        ORDER BY v.site_id, day`)
      return ok(
        rows
          .filter((row) => row.day >= input.from && row.day <= input.to)
          .map((row) => ({
            siteId: row.site_id,
            day: row.day,
            views: num(row.views),
          })),
      )
    } catch (error) {
      return err(dbError('Failed to read workspace site metrics', error))
    }
  },
}
