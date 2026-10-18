import type { AiFeedbackSurface } from '@prisma/client'
import { findAiModel } from '@/src/lib/ai/models'
import {
  AI_FEEDBACK_REASON_LABELS,
  AI_FEEDBACK_SURFACE_LABELS,
  AI_FEEDBACK_SURFACES,
  type AiFeedbackReason,
} from '@/src/lib/ai/quality-labels'
import { addUtcDays, type UtcRange, utcDayKey } from '@/src/lib/ai/usage-period'
import type {
  AiQualityDailyRow,
  AiQualityFeedbackRow,
  AiQualityGroupRow,
  AiQualityLinkContext,
  AiResolutionCounts,
} from '@/src/repositories/ai-quality.repository'
import type { AiQualityQuery } from '@/src/schemas/ai-feedback.schema'
import type {
  AiQualityBreakdownItemDTO,
  AiQualityDTO,
  AiQualityLinkDTO,
  AiQualityResolutionItemDTO,
  AiQualityTotalsDTO,
  AiQualityWorstItemDTO,
} from '@/types/ai-quality'
import { csvLine } from './ai-usage-analytics.mapper'

/** Label of feedback with no recorded model. */
export const AI_QUALITY_NO_MODEL_LABEL = 'Modelo não identificado'

export function approvalRate(up: number, total: number): number | null {
  return total > 0 ? up / total : null
}

function totalsOf(up: number, down: number): AiQualityTotalsDTO {
  return {
    up,
    down,
    total: up + down,
    approvalRate: approvalRate(up, up + down),
  }
}

export function modelLabel(modelKey: string | null): string {
  if (!modelKey) return AI_QUALITY_NO_MODEL_LABEL
  return findAiModel(modelKey)?.label ?? modelKey
}

function reasonLabel(reason: string | null): string | null {
  if (!reason) return null
  return AI_FEEDBACK_REASON_LABELS[reason as AiFeedbackReason] ?? reason
}

/** Totals per key, most rated first (ties by label). */
function breakdown(
  groups: AiQualityGroupRow[],
  keyOf: (row: AiQualityGroupRow) => string,
  labelOf: (key: string) => string,
): AiQualityBreakdownItemDTO[] {
  const acc = new Map<string, { up: number; down: number }>()
  for (const row of groups) {
    const key = keyOf(row)
    const item = acc.get(key) ?? { up: 0, down: 0 }
    if (row.rating === 'UP') item.up += row.count
    else item.down += row.count
    acc.set(key, item)
  }
  return [...acc.entries()]
    .map(([key, { up, down }]) => ({
      key,
      label: labelOf(key),
      ...totalsOf(up, down),
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
}

export function resolutionItem(
  counts: AiResolutionCounts,
  costUsd: number,
): AiQualityResolutionItemDTO {
  return {
    handled: counts.handled,
    resolved: counts.resolved,
    rate: counts.handled > 0 ? counts.resolved / counts.handled : null,
    costUsd,
    costPerResolutionUsd:
      counts.resolved > 0 ? costUsd / counts.resolved : null,
  }
}

/** UI link of a rated answer; chats open only for their owner. */
export function linkFor(
  row: Pick<AiQualityFeedbackRow, 'surface' | 'targetId'>,
  context: AiQualityLinkContext,
  viewerId: string,
): AiQualityLinkDTO | null {
  switch (row.surface) {
    case 'STEEL_AI_MESSAGE': {
      const chat = context.chats.get(row.targetId)
      return chat && chat.ownerId === viewerId
        ? { kind: 'chat', conversationId: chat.conversationId }
        : null
    }
    case 'STEEL_AGENT_RUN': {
      const run = context.agentRuns.get(row.targetId)
      return run
        ? { kind: 'agent_run', agentId: run.agentId, runId: row.targetId }
        : null
    }
    case 'SD_COPILOT':
    case 'SD_TRIAGE': {
      const ticket = context.tickets.get(row.targetId)
      return ticket ? { kind: 'ticket', ticketNumber: ticket.number } : null
    }
    case 'SD_KCS_DRAFT':
      return context.articles.has(row.targetId)
        ? { kind: 'kb_article', articleId: row.targetId }
        : null
    default: {
      const message = context.whatsapp.get(row.targetId)
      return message
        ? { kind: 'whatsapp', conversationId: message.conversationId }
        : null
    }
  }
}

export function toAiQualityWorstItemDTO(
  row: AiQualityFeedbackRow,
  context: AiQualityLinkContext,
  viewerId: string,
  showUser: boolean,
): AiQualityWorstItemDTO {
  return {
    id: row.id,
    surface: row.surface,
    surfaceLabel: AI_FEEDBACK_SURFACE_LABELS[row.surface],
    variant: row.variant,
    reason: (row.reason as AiFeedbackReason | null) ?? null,
    reasonLabel: reasonLabel(row.reason),
    comment: row.comment,
    modelKey: row.modelKey,
    modelLabel: row.modelKey ? modelLabel(row.modelKey) : null,
    userName: showUser ? (row.userName ?? 'Usuário removido') : null,
    createdAt: row.createdAt.toISOString(),
    link: linkFor(row, context, viewerId),
  }
}

/** Every UTC day of the range, zero-filled. */
function dailySeries(range: UtcRange, rows: AiQualityDailyRow[]) {
  const byDay = new Map(rows.map((row) => [row.day, row]))
  const out: AiQualityDTO['daily'] = []
  for (let day = range.from; day < range.to; day = addUtcDays(day, 1)) {
    const key = utcDayKey(day)
    const row = byDay.get(key)
    const up = row?.up ?? 0
    const down = row?.down ?? 0
    out.push({ date: key, up, down, approvalRate: approvalRate(up, up + down) })
  }
  return out
}

export function toAiQualityDTO(input: {
  query: AiQualityQuery
  range: UtcRange
  canViewWorkspace: boolean
  groups: AiQualityGroupRow[]
  daily: AiQualityDailyRow[]
  resolution: AiQualityDTO['resolution']
  worst: AiQualityWorstItemDTO[]
}): AiQualityDTO {
  let up = 0
  let down = 0
  for (const row of input.groups) {
    if (row.rating === 'UP') up += row.count
    else down += row.count
  }
  const surfaceOrder = new Map<string, number>(
    AI_FEEDBACK_SURFACES.map((surface, index) => [surface, index]),
  )
  return {
    scope: input.query.scope,
    period: input.query.period,
    from: input.range.from.toISOString(),
    to: input.range.to.toISOString(),
    canViewWorkspace: input.canViewWorkspace,
    totals: totalsOf(up, down),
    bySurface: breakdown(
      input.groups,
      (row) => row.surface,
      (key) => AI_FEEDBACK_SURFACE_LABELS[key as AiFeedbackSurface],
    ).sort(
      (a, b) =>
        b.total - a.total ||
        (surfaceOrder.get(a.key) ?? 0) - (surfaceOrder.get(b.key) ?? 0),
    ),
    byModel: breakdown(
      input.groups,
      (row) => row.modelKey ?? '',
      (key) => modelLabel(key || null),
    ),
    daily: dailySeries(input.range, input.daily),
    resolution: input.resolution,
    worst: input.worst,
  }
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

export const AI_QUALITY_ROWS_CSV_HEADER = [
  'data_utc',
  'usuario',
  'email',
  'superficie',
  'codigo_superficie',
  'variacao',
  'id_resposta',
  'avaliacao',
  'motivo',
  'comentario',
  'modelo',
]

export function toAiQualityCsvRow(
  row: AiQualityFeedbackRow,
  showUser: boolean,
): string {
  return csvLine([
    row.createdAt.toISOString(),
    showUser ? (row.userName ?? 'Usuário removido') : null,
    showUser ? row.userEmail : null,
    AI_FEEDBACK_SURFACE_LABELS[row.surface],
    row.surface,
    row.variant || null,
    row.targetId,
    row.rating === 'UP' ? 'positiva' : 'negativa',
    reasonLabel(row.reason),
    row.comment,
    row.modelKey ? modelLabel(row.modelKey) : null,
  ])
}

export const AI_QUALITY_AGGREGATE_CSV_HEADER = [
  'chave',
  'nome',
  'positivas',
  'negativas',
  'total',
  'aprovacao_percentual',
]

export function toAiQualityAggregateCsvRow(
  item: AiQualityBreakdownItemDTO,
): string {
  return csvLine([
    item.key || null,
    item.label,
    item.up,
    item.down,
    item.total,
    item.approvalRate === null
      ? null
      : Math.round(item.approvalRate * 1000) / 10,
  ])
}
