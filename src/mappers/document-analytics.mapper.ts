import type { DocumentSectionInfo } from '@/src/lib/canvas-document/sections'
import type {
  DocumentDailyRow,
  DocumentDeviceRow,
  DocumentReaderRow,
  DocumentSectionRow,
  DocumentTotalsRow,
} from '@/src/repositories/document-analytics.repository'
import type { DocumentAnalyticsDTO } from '@/types/document'

/** Name of a section that is no longer in the current version. */
export const REMOVED_SECTION_NAME = 'Seção removida'

const DEVICES = ['desktop', 'tablet', 'mobile'] as const

export interface DocumentAnalyticsRows {
  /** Sections of the current version, in reading order. */
  structure: DocumentSectionInfo[]
  totals: DocumentTotalsRow
  forwards: number
  sections: DocumentSectionRow[]
  devices: DocumentDeviceRow[]
  readers: DocumentReaderRow[]
  daily: DocumentDailyRow[]
  /** Every local day of the period (`YYYY-MM-DD`), filled with zeros. */
  days: string[]
}

const ratio = (part: number, whole: number) =>
  whole > 0 ? Math.min(1, part / whole) : 0

const average = (total: number, count: number) =>
  count > 0 ? Math.round(total / count) : 0

export function emptyDocumentTotals(): DocumentTotalsRow {
  return {
    sessions: 0,
    uniqueVisitors: 0,
    totalActiveMs: 0,
    avgScrollPct: 0,
    reachedEnd: 0,
  }
}

export function toDocumentAnalyticsDTO(
  rows: DocumentAnalyticsRows,
): DocumentAnalyticsDTO {
  const { totals } = rows
  const sessions = totals.sessions

  const statOf = new Map(rows.sections.map((row) => [row.sectionId, row]))
  const known = new Set(rows.structure.map((section) => section.id))
  const removed = rows.sections
    .filter((row) => !known.has(row.sectionId))
    .sort((a, b) => b.totalActiveMs - a.totalActiveMs)

  const sections: DocumentAnalyticsDTO['sections'] = [
    ...rows.structure.map((section) => ({
      id: section.id,
      name: section.name,
      index: section.index,
    })),
    ...removed.map((row, offset) => ({
      id: row.sectionId,
      name: REMOVED_SECTION_NAME,
      index: rows.structure.length + offset,
    })),
  ].map((section) => {
    const stat = statOf.get(section.id)
    const total = stat?.totalActiveMs ?? 0
    const readers = stat?.readers ?? 0
    return {
      ...section,
      totalActiveMs: total,
      avgActiveMs: average(total, readers),
      readers,
      reachRate: ratio(readers, sessions),
    }
  })

  const devices: DocumentAnalyticsDTO['devices'] = {
    desktop: 0,
    tablet: 0,
    mobile: 0,
    unknown: 0,
  }
  for (const row of rows.devices) {
    const key = DEVICES.find((device) => device === row.device) ?? 'unknown'
    devices[key] += row.sessions
  }

  const dailyOf = new Map(rows.daily.map((row) => [row.date, row]))

  return {
    totals: {
      sessions,
      uniqueVisitors: totals.uniqueVisitors,
      totalActiveMs: totals.totalActiveMs,
      avgActiveMs: average(totals.totalActiveMs, sessions),
      avgScrollPct: Math.round(totals.avgScrollPct),
      completionRate: ratio(totals.reachedEnd, sessions),
      revisits: Math.max(0, sessions - totals.uniqueVisitors),
      forwards: rows.forwards,
    },
    sections,
    devices,
    readers: rows.readers.map((reader) => ({
      recipientId: reader.recipientId,
      name: reader.name,
      visitorId: reader.visitorId,
      sessions: reader.sessions,
      activeMs: reader.activeMs,
      device: reader.device,
      lastSeenAt: reader.lastSeenAt.toISOString(),
    })),
    daily: rows.days.map((date) => ({
      date,
      sessions: dailyOf.get(date)?.sessions ?? 0,
      activeMs: dailyOf.get(date)?.activeMs ?? 0,
    })),
  }
}
