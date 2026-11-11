import { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Read side of the document reading analytics (ADR 0063): SQL aggregates
 * over `document_sessions`, `document_section_stats` and `document_events`
 * for one document or for every document created from a template.
 */

export interface DocumentAnalyticsScope {
  documentIds: string[]
  /** Sessions started at or after this instant; `null` = all time. */
  since: Date | null
}

export interface DocumentAnalyticsTarget {
  id: string
  isTemplate: boolean
  content: Prisma.JsonValue
  currentVersionContent: Prisma.JsonValue | null
}

export interface DocumentTotalsRow {
  sessions: number
  uniqueVisitors: number
  totalActiveMs: number
  avgScrollPct: number
  reachedEnd: number
}

export interface DocumentSectionRow {
  sectionId: string
  totalActiveMs: number
  readers: number
}

export interface DocumentDeviceRow {
  device: string | null
  sessions: number
}

export interface DocumentReaderRow {
  recipientId: string | null
  name: string | null
  visitorId: string
  sessions: number
  activeMs: number
  device: string | null
  lastSeenAt: Date
}

export interface DocumentDailyRow {
  date: string
  sessions: number
  activeMs: number
}

const num = (value: unknown) => Number(value ?? 0)

function sessionFilter(scope: DocumentAnalyticsScope, alias = 's') {
  const column = (name: string) => Prisma.raw(`${alias}.${name}`)
  const since = scope.since
    ? Prisma.sql`AND ${column('started_at')} >= ${scope.since}`
    : Prisma.empty
  return Prisma.sql`${column('document_id')} IN (${Prisma.join(
    scope.documentIds,
  )}) ${since}`
}

export const DocumentAnalyticsRepository = {
  async findTarget(
    workspaceId: string,
    documentId: string,
  ): Promise<Result<DocumentAnalyticsTarget | null>> {
    try {
      const document = await prisma.document.findFirst({
        where: { id: documentId, workspaceId, deletedAt: null },
        select: {
          id: true,
          isTemplate: true,
          content: true,
          currentVersion: { select: { content: true } },
        },
      })
      if (!document) return ok(null)
      return ok({
        id: document.id,
        isTemplate: document.isTemplate,
        content: document.content,
        currentVersionContent: document.currentVersion?.content ?? null,
      })
    } catch (error) {
      return err(dbError('Failed to load the analytics document', error))
    }
  },

  /** Live documents created from a template. */
  async documentIdsFromTemplate(
    workspaceId: string,
    templateId: string,
  ): Promise<Result<string[]>> {
    try {
      const rows = await prisma.document.findMany({
        where: { workspaceId, templateId, deletedAt: null, isTemplate: false },
        select: { id: true },
      })
      return ok(rows.map((row) => row.id))
    } catch (error) {
      return err(dbError('Failed to list documents of the template', error))
    }
  },

  async totals(
    scope: DocumentAnalyticsScope,
  ): Promise<Result<DocumentTotalsRow>> {
    try {
      const [row] = await prisma.$queryRaw<
        Array<{
          sessions: bigint
          visitors: bigint
          active_ms: bigint | null
          avg_scroll: number | null
          reached_end: bigint
        }>
      >(Prisma.sql`
        SELECT count(*) AS sessions,
          count(DISTINCT s.visitor_id) AS visitors,
          sum(s.active_ms) AS active_ms,
          avg(s.max_scroll_pct)::float8 AS avg_scroll,
          count(*) FILTER (WHERE s.reached_end) AS reached_end
        FROM document_sessions s
        WHERE ${sessionFilter(scope)}`)
      return ok({
        sessions: num(row?.sessions),
        uniqueVisitors: num(row?.visitors),
        totalActiveMs: num(row?.active_ms),
        avgScrollPct: num(row?.avg_scroll),
        reachedEnd: num(row?.reached_end),
      })
    } catch (error) {
      return err(dbError('Failed to read document reading totals', error))
    }
  },

  /** FORWARDED events (new visitors on a personal link) in the period. */
  async forwards(scope: DocumentAnalyticsScope): Promise<Result<number>> {
    try {
      const count = await prisma.documentEvent.count({
        where: {
          documentId: { in: scope.documentIds },
          type: 'FORWARDED',
          ...(scope.since ? { createdAt: { gte: scope.since } } : {}),
        },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count document forwards', error))
    }
  },

  async sections(
    scope: DocumentAnalyticsScope,
  ): Promise<Result<DocumentSectionRow[]>> {
    try {
      const rows = await prisma.$queryRaw<
        Array<{ section_id: string; active_ms: bigint; readers: bigint }>
      >(Prisma.sql`
        SELECT st.section_id,
          sum(st.active_ms) AS active_ms,
          count(DISTINCT st.session_id) AS readers
        FROM document_section_stats st
        JOIN document_sessions s ON s.id = st.session_id
        WHERE ${sessionFilter(scope)}
        GROUP BY st.section_id`)
      return ok(
        rows.map((row) => ({
          sectionId: row.section_id,
          totalActiveMs: num(row.active_ms),
          readers: num(row.readers),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to read document section stats', error))
    }
  },

  async devices(
    scope: DocumentAnalyticsScope,
  ): Promise<Result<DocumentDeviceRow[]>> {
    try {
      const rows = await prisma.$queryRaw<
        Array<{ device: string | null; sessions: bigint }>
      >(Prisma.sql`
        SELECT s.device, count(*) AS sessions
        FROM document_sessions s
        WHERE ${sessionFilter(scope)}
        GROUP BY s.device`)
      return ok(
        rows.map((row) => ({
          device: row.device,
          sessions: num(row.sessions),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to read document devices', error))
    }
  },

  /** Readers (visitor × recipient), most recent first. */
  async readers(
    scope: DocumentAnalyticsScope,
    limit = 50,
  ): Promise<Result<DocumentReaderRow[]>> {
    try {
      const rows = await prisma.$queryRaw<
        Array<{
          recipient_id: string | null
          name: string | null
          visitor_id: string
          sessions: bigint
          active_ms: bigint | null
          device: string | null
          last_seen_at: Date
        }>
      >(Prisma.sql`
        SELECT s.recipient_id, max(r.name) AS name, s.visitor_id,
          count(*) AS sessions,
          sum(s.active_ms) AS active_ms,
          (array_agg(s.device ORDER BY s.last_seen_at DESC))[1] AS device,
          max(s.last_seen_at) AS last_seen_at
        FROM document_sessions s
        LEFT JOIN document_recipients r ON r.id = s.recipient_id
        WHERE ${sessionFilter(scope)}
        GROUP BY s.visitor_id, s.recipient_id
        ORDER BY last_seen_at DESC
        LIMIT ${limit}`)
      return ok(
        rows.map((row) => ({
          recipientId: row.recipient_id,
          name: row.name,
          visitorId: row.visitor_id,
          sessions: num(row.sessions),
          activeMs: num(row.active_ms),
          device: row.device,
          lastSeenAt: row.last_seen_at,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to read document readers', error))
    }
  },

  /** Sessions and active time per local day (`YYYY-MM-DD` in `timezone`). */
  async daily(
    scope: DocumentAnalyticsScope,
    timezone: string,
  ): Promise<Result<DocumentDailyRow[]>> {
    try {
      const rows = await prisma.$queryRaw<
        Array<{ day: string; sessions: bigint; active_ms: bigint | null }>
      >(Prisma.sql`
        SELECT to_char(
            (s.started_at AT TIME ZONE 'UTC') AT TIME ZONE ${timezone},
            'YYYY-MM-DD'
          ) AS day,
          count(*) AS sessions,
          sum(s.active_ms) AS active_ms
        FROM document_sessions s
        WHERE ${sessionFilter(scope)}
        GROUP BY day
        ORDER BY day`)
      return ok(
        rows.map((row) => ({
          date: row.day,
          sessions: num(row.sessions),
          activeMs: num(row.active_ms),
        })),
      )
    } catch (error) {
      return err(dbError('Failed to read document daily reading', error))
    }
  },
}
