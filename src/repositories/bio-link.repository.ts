import { type BioLink, type BioLinkEventKind, Prisma } from '@prisma/client'
import { appError } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export interface BioLinkTotals {
  views: number
  clicks: number
}

export interface BioLinkEventInput {
  bioLinkId: string
  kind: BioLinkEventKind
  linkId?: string | null
  linkTitle?: string | null
  visitorHash: string
  referrer?: string | null
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  country?: string | null
  device?: string | null
}

export interface BioLinkWindow {
  bioLinkId: string
  start: Date
  end: Date
  timezone: string
}

export interface BioDailyRow {
  day: string
  kind: BioLinkEventKind
  count: number
}

export interface BioCountRow {
  key: string | null
  count: number
}

export interface BioClickRow {
  linkId: string
  linkTitle: string | null
  count: number
}

const notFound = () =>
  appError('BIO_LINK_NOT_FOUND', 'Link da bio não encontrado')

/** Columns a breakdown may group by (raw SQL: only these literals). */
const BREAKDOWN_COLUMNS = {
  referrer: 'referrer',
  utmSource: 'utm_source',
  country: 'country',
  device: 'device',
} as const

export const BioLinkRepository = {
  async listByWorkspace(workspaceId: string): Promise<Result<BioLink[]>> {
    try {
      return ok(
        await prisma.bioLink.findMany({
          where: { workspaceId, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list bio links', error))
    }
  },

  async countByWorkspace(workspaceId: string): Promise<Result<number>> {
    try {
      return ok(
        await prisma.bioLink.count({ where: { workspaceId, deletedAt: null } }),
      )
    } catch (error) {
      return err(dbError('Failed to count bio links', error))
    }
  },

  async findById(id: string, workspaceId: string): Promise<Result<BioLink>> {
    try {
      const row = await prisma.bioLink.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })
      if (!row) return err(notFound())
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find bio link by id', error))
    }
  },

  /** A published page by its public address. */
  async findPublishedBySlug(slug: string): Promise<Result<BioLink>> {
    try {
      const row = await prisma.bioLink.findFirst({
        where: { slug, status: 'PUBLISHED', deletedAt: null },
      })
      if (!row) return err(notFound())
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find bio link by slug', error))
    }
  },

  async isSlugTaken(slug: string, exceptId?: string): Promise<Result<boolean>> {
    try {
      const row = await prisma.bioLink.findUnique({
        where: { slug },
        select: { id: true },
      })
      return ok(Boolean(row && row.id !== exceptId))
    } catch (error) {
      return err(dbError('Failed to check bio link slug', error))
    }
  },

  async create(data: {
    workspaceId: string
    createdById: string
    name: string
    slug: string
    title: string
    theme: Prisma.InputJsonValue
    blocks: Prisma.InputJsonValue
  }): Promise<Result<BioLink>> {
    try {
      return ok(await prisma.bioLink.create({ data }))
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        return err(
          appError('BIO_LINK_SLUG_TAKEN', 'Este endereço já está em uso'),
        )
      }
      return err(dbError('Failed to create bio link', error))
    }
  },

  async update(
    id: string,
    workspaceId: string,
    data: Prisma.BioLinkUncheckedUpdateInput,
  ): Promise<Result<BioLink>> {
    try {
      const found = await prisma.bioLink.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select: { id: true },
      })
      if (!found) return err(notFound())
      return ok(await prisma.bioLink.update({ where: { id }, data }))
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        return err(
          appError('BIO_LINK_SLUG_TAKEN', 'Este endereço já está em uso'),
        )
      }
      return err(dbError('Failed to update bio link', error))
    }
  },

  /** Hard delete: the address is freed and the events go with it. */
  async remove(id: string, workspaceId: string): Promise<Result<BioLink>> {
    try {
      const found = await prisma.bioLink.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })
      if (!found) return err(notFound())
      await prisma.bioLink.delete({ where: { id } })
      return ok(found)
    } catch (error) {
      return err(dbError('Failed to delete bio link', error))
    }
  },
}

export const BioLinkEventRepository = {
  async record(input: BioLinkEventInput): Promise<Result<void>> {
    try {
      await prisma.bioLinkEvent.create({ data: input })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to record bio link event', error))
    }
  },

  /** All-time views and clicks of each page. */
  async totalsFor(
    bioLinkIds: string[],
  ): Promise<Result<Map<string, BioLinkTotals>>> {
    try {
      const rows = await prisma.bioLinkEvent.groupBy({
        by: ['bioLinkId', 'kind'],
        where: { bioLinkId: { in: bioLinkIds } },
        _count: { _all: true },
      })
      const totals = new Map<string, BioLinkTotals>()
      for (const row of rows) {
        const current = totals.get(row.bioLinkId) ?? { views: 0, clicks: 0 }
        if (row.kind === 'VIEW') current.views += row._count._all
        else current.clicks += row._count._all
        totals.set(row.bioLinkId, current)
      }
      return ok(totals)
    } catch (error) {
      return err(dbError('Failed to total bio link events', error))
    }
  },

  /** Events per local day and kind. */
  async daily(window: BioLinkWindow): Promise<Result<BioDailyRow[]>> {
    try {
      const rows = await prisma.$queryRaw<
        { day: string; kind: BioLinkEventKind; count: number }[]
      >`
        SELECT to_char((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${window.timezone}, 'YYYY-MM-DD') AS day,
               kind::text AS kind,
               COUNT(*)::int AS count
        FROM bio_link_events
        WHERE bio_link_id = ${window.bioLinkId}
          AND created_at >= ${window.start}
          AND created_at < ${window.end}
        GROUP BY 1, 2
        ORDER BY 1`
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to read daily bio link events', error))
    }
  },

  /** Distinct daily visitor hashes among the page views. */
  async visitors(window: BioLinkWindow): Promise<Result<number>> {
    try {
      const rows = await prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(DISTINCT visitor_hash)::int AS count
        FROM bio_link_events
        WHERE bio_link_id = ${window.bioLinkId}
          AND kind = 'VIEW'
          AND created_at >= ${window.start}
          AND created_at < ${window.end}`
      return ok(rows[0]?.count ?? 0)
    } catch (error) {
      return err(dbError('Failed to count bio link visitors', error))
    }
  },

  /** Page views grouped by one column, biggest first. */
  async breakdown(
    window: BioLinkWindow,
    column: keyof typeof BREAKDOWN_COLUMNS,
    take = 8,
  ): Promise<Result<BioCountRow[]>> {
    try {
      const field = Prisma.raw(BREAKDOWN_COLUMNS[column])
      const rows = await prisma.$queryRaw<
        { value: string | null; count: number }[]
      >`
        SELECT ${field} AS value, COUNT(*)::int AS count
        FROM bio_link_events
        WHERE bio_link_id = ${window.bioLinkId}
          AND kind = 'VIEW'
          AND created_at >= ${window.start}
          AND created_at < ${window.end}
        GROUP BY 1
        ORDER BY count DESC
        LIMIT ${take}`
      return ok(rows.map((row) => ({ key: row.value, count: row.count })))
    } catch (error) {
      return err(dbError('Failed to break down bio link events', error))
    }
  },

  /** Clicks per link, most clicked first. */
  async clicksByLink(window: BioLinkWindow): Promise<Result<BioClickRow[]>> {
    try {
      const rows = await prisma.$queryRaw<
        { link_id: string; link_title: string | null; count: number }[]
      >`
        SELECT link_id, MAX(link_title) AS link_title, COUNT(*)::int AS count
        FROM bio_link_events
        WHERE bio_link_id = ${window.bioLinkId}
          AND kind = 'CLICK'
          AND link_id IS NOT NULL
          AND created_at >= ${window.start}
          AND created_at < ${window.end}
        GROUP BY link_id
        ORDER BY count DESC
        LIMIT 50`
      return ok(
        rows.map((row) => ({
          linkId: row.link_id,
          linkTitle: row.link_title,
          count: row.count,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to read bio link clicks', error))
    }
  },
}

/** Reads of other modules that feed the editor's ready-made buttons. */
export const BioLinkLookupRepository = {
  async whatsappLines(
    workspaceId: string,
  ): Promise<Result<{ id: string; label: string; phone: string }[]>> {
    try {
      const rows = await prisma.whatsAppConnection.findMany({
        where: { workspaceId, module: 'COMMUNICATION', status: 'CONNECTED' },
        select: { id: true, label: true, phoneNumber: true },
        orderBy: { createdAt: 'asc' },
      })
      return ok(
        rows.map((row) => ({
          id: row.id,
          label: row.label,
          phone: row.phoneNumber,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp lines for bio link', error))
    }
  },

  async publishedSites(
    workspaceId: string,
  ): Promise<Result<{ id: string; name: string; slug: string }[]>> {
    try {
      return ok(
        await prisma.site.findMany({
          where: { workspaceId, status: 'PUBLISHED', deletedAt: null },
          select: { id: true, name: true, slug: true },
          orderBy: { name: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list sites for bio link', error))
    }
  },

  async publishedForms(
    workspaceId: string,
  ): Promise<Result<{ id: string; name: string; publicToken: string }[]>> {
    try {
      return ok(
        await prisma.crmForm.findMany({
          where: { workspaceId, status: 'PUBLISHED', deletedAt: null },
          select: { id: true, name: true, publicToken: true },
          orderBy: { name: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list forms for bio link', error))
    }
  },
}
