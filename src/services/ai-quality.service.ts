import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { forbidden } from '@/src/errors'
import {
  addUtcDays,
  resolveAiUsagePeriod,
  type UtcRange,
  utcDayKey,
} from '@/src/lib/ai/usage-period'
import { err, ok, type Result } from '@/src/lib/result'
import {
  AI_QUALITY_AGGREGATE_CSV_HEADER,
  AI_QUALITY_ROWS_CSV_HEADER,
  resolutionItem,
  toAiQualityAggregateCsvRow,
  toAiQualityCsvRow,
  toAiQualityDTO,
  toAiQualityWorstItemDTO,
} from '@/src/mappers/ai-quality.mapper'
import { csvLine } from '@/src/mappers/ai-usage-analytics.mapper'
import { AiQualityRepository } from '@/src/repositories/ai-quality.repository'
import type {
  AiQualityExportQuery,
  AiQualityQuery,
} from '@/src/schemas/ai-feedback.schema'
import type { AiQualityDTO, AiQualityResolutionDTO } from '@/types/ai-quality'
import { assertMember, type MembershipContext } from './authz'

/** Thumbs down listed in "piores respostas". */
export const AI_QUALITY_WORST_LIMIT = 20
/** Feedback rows fetched per round trip by the CSV export. */
export const AI_QUALITY_EXPORT_PAGE_SIZE = 1000

const BYTE_ORDER_MARK = '﻿'

export interface AiQualityCsvExport {
  filename: string
  chunks: AsyncGenerator<string>
}

/** Personal = the actor's own ratings; workspace = OWNER/ADMIN only. */
async function authorizeScope(
  actorId: string,
  workspaceId: string,
  scope: AiQualityQuery['scope'],
): Promise<Result<MembershipContext>> {
  const membership = await assertMember(actorId, workspaceId)
  if (!membership.ok) return membership
  if (scope === 'workspace' && !membership.value.isPrivileged) {
    return err(
      forbidden(
        'Só o dono e os administradores veem a qualidade da IA de todo o espaço de trabalho',
      ),
    )
  }
  return membership
}

async function buildResolution(
  workspaceId: string,
  range: UtcRange,
): Promise<Result<AiQualityResolutionDTO>> {
  const [whatsapp, servicedesk, costs] = await Promise.all([
    AiQualityRepository.whatsappResolution(workspaceId, range),
    AiQualityRepository.servicedeskResolution(workspaceId, range),
    AiQualityRepository.featureCosts(workspaceId, range, [
      'WHATSAPP_REPLY',
      'SERVICEDESK_PRE_SERVICE',
    ]),
  ])
  if (!whatsapp.ok) return whatsapp
  if (!servicedesk.ok) return servicedesk
  if (!costs.ok) return costs
  const waCost = costs.value.WHATSAPP_REPLY ?? 0
  const sdCost = costs.value.SERVICEDESK_PRE_SERVICE ?? 0
  return ok({
    whatsapp: resolutionItem(whatsapp.value, waCost),
    servicedesk: resolutionItem(servicedesk.value, sdCost),
    total: resolutionItem(
      {
        handled: whatsapp.value.handled + servicedesk.value.handled,
        resolved: whatsapp.value.resolved + servicedesk.value.resolved,
      },
      waCost + sdCost,
    ),
  })
}

async function buildQuality(
  actorId: string,
  workspaceId: string,
  query: AiQualityQuery,
  range: UtcRange,
  canViewWorkspace: boolean,
): Promise<Result<AiQualityDTO>> {
  const workspace = query.scope === 'workspace'
  const userId = workspace ? undefined : actorId
  const [groups, daily, worst, resolution] = await Promise.all([
    AiQualityRepository.groupRatings(workspaceId, range, userId),
    AiQualityRepository.dailyRatings(workspaceId, range, userId),
    AiQualityRepository.latestDown(workspaceId, range, {
      userId,
      take: AI_QUALITY_WORST_LIMIT,
    }),
    workspace ? buildResolution(workspaceId, range) : Promise.resolve(ok(null)),
  ])
  if (!groups.ok) return groups
  if (!daily.ok) return daily
  if (!worst.ok) return worst
  if (!resolution.ok) return resolution

  const links = await AiQualityRepository.linkContext(workspaceId, worst.value)
  if (!links.ok) return links

  return ok(
    toAiQualityDTO({
      query,
      range,
      canViewWorkspace,
      groups: groups.value,
      daily: daily.value,
      resolution: resolution.value,
      worst: worst.value.map((row) =>
        toAiQualityWorstItemDTO(row, links.value, actorId, workspace),
      ),
    }),
  )
}

async function* rowChunks(
  workspaceId: string,
  range: UtcRange,
  userId: string | undefined,
): AsyncGenerator<string> {
  yield BYTE_ORDER_MARK + csvLine(AI_QUALITY_ROWS_CSV_HEADER)
  let cursor: string | undefined
  for (;;) {
    const page = await AiQualityRepository.exportPage(workspaceId, range, {
      userId,
      cursor,
      take: AI_QUALITY_EXPORT_PAGE_SIZE,
    })
    if (!page.ok) {
      logger.error(
        'ai.quality_export_failed',
        logFields(
          {
            component: 'AiQualityService',
            workspaceId,
            message: page.error.message,
          },
          { cursor: cursor ?? null },
        ),
      )
      throw new Error(page.error.message)
    }
    if (page.value.length === 0) return
    yield page.value.map((row) => toAiQualityCsvRow(row, !userId)).join('')
    if (page.value.length < AI_QUALITY_EXPORT_PAGE_SIZE) return
    cursor = page.value[page.value.length - 1].id
  }
}

async function* aggregateChunks(
  items: AiQualityDTO['bySurface'],
): AsyncGenerator<string> {
  yield BYTE_ORDER_MARK + csvLine(AI_QUALITY_AGGREGATE_CSV_HEADER)
  if (items.length > 0) yield items.map(toAiQualityAggregateCsvRow).join('')
}

/**
 * Steel AI › Análises › Qualidade (ADR 0039): approval of the AI answers by
 * surface, model and day, resolution without a human, cost per resolution
 * and the worst-rated answers. Days are UTC like the usage analytics.
 */
export const AiQualityService = {
  async quality(
    actorId: string,
    workspaceId: string,
    query: AiQualityQuery,
    now: Date = new Date(),
  ): Promise<Result<AiQualityDTO>> {
    const membership = await authorizeScope(actorId, workspaceId, query.scope)
    if (!membership.ok) return membership
    return buildQuality(
      actorId,
      workspaceId,
      query,
      resolveAiUsagePeriod(query, now),
      membership.value.isPrivileged,
    )
  },

  /** CSV of a period; the workspace export names who rated (audited). */
  async exportCsv(
    actorId: string,
    workspaceId: string,
    query: AiQualityExportQuery,
    now: Date = new Date(),
  ): Promise<Result<AiQualityCsvExport>> {
    const membership = await authorizeScope(actorId, workspaceId, query.scope)
    if (!membership.ok) return membership

    const range = resolveAiUsagePeriod(query, now)
    const personal = query.scope === 'personal'
    const filename = `steel-ai-qualidade-${personal ? 'pessoal' : 'workspace'}-${query.view}-${utcDayKey(range.from)}_${utcDayKey(addUtcDays(range.to, -1))}.csv`

    let chunks: AsyncGenerator<string>
    if (query.view === 'feedback') {
      chunks = rowChunks(workspaceId, range, personal ? actorId : undefined)
    } else {
      const quality = await buildQuality(
        actorId,
        workspaceId,
        query,
        range,
        membership.value.isPrivileged,
      )
      if (!quality.ok) return quality
      chunks = aggregateChunks(
        query.view === 'surface'
          ? quality.value.bySurface
          : quality.value.byModel,
      )
    }

    auditMutation({
      entity: 'ai_quality',
      action: 'download',
      actorId,
      targetId: workspaceId,
      meta: {
        scope: query.scope,
        view: query.view,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
    })
    return ok({ filename, chunks })
  },
}
