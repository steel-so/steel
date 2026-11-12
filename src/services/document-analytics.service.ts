import { documentNotFound } from '@/src/errors/app-error'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  type DocumentSectionInfo,
  documentSections,
} from '@/src/lib/canvas-document/sections'
import { err, ok, type Result } from '@/src/lib/result'
import {
  addDays,
  listDays,
  localDayOf,
  startOfLocalDay,
} from '@/src/lib/sites/analytics'
import {
  emptyDocumentTotals,
  toDocumentAnalyticsDTO,
} from '@/src/mappers/document-analytics.mapper'
import {
  DocumentAnalyticsRepository,
  type DocumentAnalyticsScope,
} from '@/src/repositories/document-analytics.repository'
import {
  type DocumentAnalyticsQuery,
  documentAnalyticsPeriodDays,
} from '@/src/schemas/document-analytics.schema'
import type { DocumentAnalyticsDTO } from '@/types/document'
import { assertModuleMember } from './authz'

/**
 * Reading analytics panel of a document (ADR 0063): totals, time and reach
 * per section of the current version, devices, readers and the daily
 * series. A template shows the aggregate of the documents created from it.
 * Days are counted in the CRM timezone (America/Sao_Paulo).
 */

export const DOCUMENT_ANALYTICS_TIMEZONE = 'America/Sao_Paulo'
/** Longest daily series of the "all time" period. */
const MAX_DAILY_DAYS = 366

function isCanvasDocument(value: unknown): value is CanvasDocument {
  if (!value || typeof value !== 'object') return false
  const doc = value as Partial<CanvasDocument>
  return (
    typeof doc.rootId === 'string' &&
    Boolean(doc.nodes) &&
    typeof doc.nodes === 'object'
  )
}

/** Sections of a stored canvas document; `[]` when it is not one. */
export function sectionsOfContent(content: unknown): DocumentSectionInfo[] {
  return isCanvasDocument(content) ? documentSections(content) : []
}

/** Local days of the daily series (`all`: from the first session). */
export function analyticsDays(input: {
  fromDay: string | null
  firstDay: string | null
  today: string
}): string[] {
  const start = input.fromDay ?? input.firstDay
  if (!start) return []
  const earliest = addDays(input.today, -(MAX_DAILY_DAYS - 1))
  return listDays(start < earliest ? earliest : start, input.today)
}

export const DocumentAnalyticsService = {
  async get(
    actorId: string,
    workspaceId: string,
    documentId: string,
    query: DocumentAnalyticsQuery,
    now: Date = new Date(),
  ): Promise<Result<DocumentAnalyticsDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const target = await DocumentAnalyticsRepository.findTarget(
      workspaceId,
      documentId,
    )
    if (!target.ok) return target
    if (!target.value) return err(documentNotFound())

    const structure = sectionsOfContent(
      target.value.isTemplate
        ? target.value.content
        : (target.value.currentVersionContent ?? target.value.content),
    )

    let documentIds = [target.value.id]
    if (target.value.isTemplate) {
      const derived = await DocumentAnalyticsRepository.documentIdsFromTemplate(
        workspaceId,
        target.value.id,
      )
      if (!derived.ok) return derived
      documentIds = derived.value
    }

    const tz = DOCUMENT_ANALYTICS_TIMEZONE
    const today = localDayOf(now, tz)
    const periodDays = documentAnalyticsPeriodDays(query.days)
    const fromDay = periodDays ? addDays(today, -(periodDays - 1)) : null

    if (documentIds.length === 0) {
      return ok(
        toDocumentAnalyticsDTO({
          structure,
          totals: emptyDocumentTotals(),
          forwards: 0,
          sections: [],
          devices: [],
          readers: [],
          daily: [],
          days: analyticsDays({ fromDay, firstDay: null, today }),
        }),
      )
    }

    const scope: DocumentAnalyticsScope = {
      documentIds,
      since: fromDay ? startOfLocalDay(fromDay, tz) : null,
    }
    const [totals, forwards, sections, devices, readers, daily] =
      await Promise.all([
        DocumentAnalyticsRepository.totals(scope),
        DocumentAnalyticsRepository.forwards(scope),
        DocumentAnalyticsRepository.sections(scope),
        DocumentAnalyticsRepository.devices(scope),
        DocumentAnalyticsRepository.readers(scope),
        DocumentAnalyticsRepository.daily(scope, tz),
      ])
    if (!totals.ok) return totals
    if (!forwards.ok) return forwards
    if (!sections.ok) return sections
    if (!devices.ok) return devices
    if (!readers.ok) return readers
    if (!daily.ok) return daily

    return ok(
      toDocumentAnalyticsDTO({
        structure,
        totals: totals.value,
        forwards: forwards.value,
        sections: sections.value,
        devices: devices.value,
        readers: readers.value,
        daily: daily.value,
        days: analyticsDays({
          fromDay,
          firstDay: daily.value[0]?.date ?? null,
          today,
        }),
      }),
    )
  },
}
