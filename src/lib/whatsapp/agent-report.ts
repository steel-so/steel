import { validationError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { WHATSAPP_AGENT_REPORT_MAX_DAYS } from '@/src/schemas/whatsapp-agent-report.schema'
import type {
  WhatsAppAgentReportDTO,
  WhatsAppAgentReportMetricsDTO,
  WhatsAppAgentReportOutcome,
  WhatsAppAgentReportRowDTO,
  WhatsAppAgentReportStatusCountDTO,
} from '@/types/whatsapp-agent-report'

/**
 * Pure math of the agent performance report (ADR 0062): São Paulo day
 * ranges, rates, averages, and the assembly of the aggregated rows read by
 * the repository into the report DTO and its CSV. No I/O.
 */

export const AGENT_REPORT_TIME_ZONE = 'America/Sao_Paulo'
export const UNASSIGNED_AGENT_LABEL = 'Sem atendente'
export const REMOVED_AGENT_LABEL = 'Atendente removido'

const DAY_MS = 24 * 60 * 60 * 1000
/** America/Sao_Paulo has no daylight saving time since 2019. */
const SAO_PAULO_OFFSET = '-03:00'

// ─── Days and periods (São Paulo calendar) ──────────────────────────────────

/** `YYYY-MM-DD` of `date` in São Paulo (never the server's or browser's zone). */
export function saoPauloDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AGENT_REPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** Calendar arithmetic on a `YYYY-MM-DD` string. */
export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** The instant a São Paulo day starts. */
export function startOfSaoPauloDay(day: string): Date {
  return new Date(`${day}T00:00:00${SAO_PAULO_OFFSET}`)
}

export type AgentReportPreset = 'today' | '7d' | '30d' | 'month'

export const AGENT_REPORT_PRESET_LABELS: Record<AgentReportPreset, string> = {
  today: 'Hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  month: 'Este mês',
}

export const AGENT_REPORT_DEFAULT_PRESET: AgentReportPreset = '7d'

/** Inclusive `from`/`to` days of a preset, relative to `now`. */
export function agentReportPresetRange(
  preset: AgentReportPreset,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = saoPauloDay(now)
  if (preset === 'today') return { from: today, to: today }
  if (preset === '7d') return { from: shiftDay(today, -6), to: today }
  if (preset === '30d') return { from: shiftDay(today, -29), to: today }
  return { from: `${today.slice(0, 7)}-01`, to: today }
}

export interface AgentReportPeriod {
  fromDay: string
  toDay: string
  /** First instant of `fromDay` in São Paulo. */
  start: Date
  /** First instant after `toDay` in São Paulo (exclusive bound). */
  endExclusive: Date
}

/**
 * Report window. Both bounds are São Paulo days and inclusive; the default is
 * the last 7 days ending today. Rejects an inverted range and one longer than
 * a year.
 */
export function resolveAgentReportPeriod(
  query: { from?: string; to?: string },
  now: Date,
): Result<AgentReportPeriod> {
  const toDay = query.to ?? saoPauloDay(now)
  const fromDay = query.from ?? shiftDay(toDay, -6)
  if (fromDay > toDay) {
    return err(validationError('A data inicial deve ser anterior à final'))
  }
  const start = startOfSaoPauloDay(fromDay)
  const endExclusive = new Date(startOfSaoPauloDay(toDay).getTime() + DAY_MS)
  const days = Math.round((endExclusive.getTime() - start.getTime()) / DAY_MS)
  if (days > WHATSAPP_AGENT_REPORT_MAX_DAYS) {
    return err(validationError('O período do relatório é de no máximo 1 ano'))
  }
  return ok({ fromDay, toDay, start, endExclusive })
}

// ─── Rates and averages ─────────────────────────────────────────────────────

/** Success share of the tabulated conversations, 0-100 with one decimal. */
export function successRate(success: number, failure: number): number | null {
  const tabulated = success + failure
  if (tabulated <= 0) return null
  return Math.round((success / tabulated) * 1000) / 10
}

/** Mean in whole seconds; `null` with no conversation to average. */
export function averageSeconds(
  totalSeconds: number,
  count: number,
): number | null {
  if (count <= 0) return null
  return Math.round(totalSeconds / count)
}

// ─── Assembly ───────────────────────────────────────────────────────────────

/** Closed conversations of one assignee, as aggregated by the repository. */
export interface AgentClosedAggregate {
  agentId: string | null
  closed: number
  success: number
  failure: number
  untabulated: number
  /** Sum of `closedAt - createdAt` over the closed conversations. */
  handlingSeconds: number
}

export interface AgentOpenAggregate {
  agentId: string | null
  open: number
}

/** Tabulated conversations of one assignee with one close status label. */
export interface AgentStatusAggregate {
  agentId: string | null
  label: string
  outcome: WhatsAppAgentReportOutcome | null
  count: number
}

function compareStatuses(
  a: WhatsAppAgentReportStatusCountDTO,
  b: WhatsAppAgentReportStatusCountDTO,
): number {
  return b.count - a.count || a.label.localeCompare(b.label, 'pt-BR')
}

/**
 * Sums the counts of the same label. A label seen with two outcomes (the
 * status was renamed or its outcome changed) keeps the outcome with more
 * conversations.
 */
export function mergeStatusCounts(
  items: {
    label: string
    outcome: WhatsAppAgentReportOutcome | null
    count: number
  }[],
): WhatsAppAgentReportStatusCountDTO[] {
  const byLabel = new Map<
    string,
    { total: number; outcomes: Map<WhatsAppAgentReportOutcome | null, number> }
  >()
  for (const item of items) {
    const entry = byLabel.get(item.label) ?? { total: 0, outcomes: new Map() }
    entry.total += item.count
    entry.outcomes.set(
      item.outcome,
      (entry.outcomes.get(item.outcome) ?? 0) + item.count,
    )
    byLabel.set(item.label, entry)
  }
  return [...byLabel.entries()]
    .map(([label, entry]) => {
      let outcome: WhatsAppAgentReportOutcome | null = null
      let best = -1
      for (const [candidate, count] of entry.outcomes) {
        if (candidate !== null && count > best) {
          outcome = candidate
          best = count
        }
      }
      return { label, outcome, count: entry.total }
    })
    .sort(compareStatuses)
}

function metricsOf(
  closed: AgentClosedAggregate[],
  open: number,
  statuses: AgentStatusAggregate[],
): WhatsAppAgentReportMetricsDTO {
  let closedCount = 0
  let success = 0
  let failure = 0
  let untabulated = 0
  let handlingSeconds = 0
  for (const row of closed) {
    closedCount += row.closed
    success += row.success
    failure += row.failure
    untabulated += row.untabulated
    handlingSeconds += row.handlingSeconds
  }
  return {
    closed: closedCount,
    tabulated: success + failure,
    success,
    failure,
    successRate: successRate(success, failure),
    untabulated,
    avgHandlingSeconds: averageSeconds(handlingSeconds, closedCount),
    open,
    byStatus: mergeStatusCounts(statuses),
  }
}

export interface AgentReportInput {
  closed: AgentClosedAggregate[]
  open: AgentOpenAggregate[]
  statuses: AgentStatusAggregate[]
  /** `userId -> name` of the workspace members. */
  agentNames: ReadonlyMap<string, string>
}

export interface AgentReportBody {
  rows: WhatsAppAgentReportRowDTO[]
  totals: WhatsAppAgentReportMetricsDTO
  statuses: WhatsAppAgentReportStatusCountDTO[]
}

function agentName(
  agentId: string | null,
  names: ReadonlyMap<string, string>,
): string {
  if (agentId === null) return UNASSIGNED_AGENT_LABEL
  return names.get(agentId) ?? REMOVED_AGENT_LABEL
}

/**
 * One row per assignee that closed or still holds conversations, the totals
 * row and the per-label summary. Most active first; "Sem atendente" last.
 */
export function buildAgentReport(input: AgentReportInput): AgentReportBody {
  const ids = new Set<string | null>()
  for (const row of input.closed) ids.add(row.agentId)
  for (const row of input.open) ids.add(row.agentId)

  const rows: WhatsAppAgentReportRowDTO[] = [...ids].map((agentId) => ({
    agentId,
    agentName: agentName(agentId, input.agentNames),
    ...metricsOf(
      input.closed.filter((row) => row.agentId === agentId),
      input.open
        .filter((row) => row.agentId === agentId)
        .reduce((sum, row) => sum + row.open, 0),
      input.statuses.filter((row) => row.agentId === agentId),
    ),
  }))

  rows.sort((a, b) => {
    if ((a.agentId === null) !== (b.agentId === null)) {
      return a.agentId === null ? 1 : -1
    }
    return (
      b.closed - a.closed ||
      b.open - a.open ||
      a.agentName.localeCompare(b.agentName, 'pt-BR')
    )
  })

  const totals = metricsOf(
    input.closed,
    input.open.reduce((sum, row) => sum + row.open, 0),
    input.statuses,
  )
  return { rows, totals, statuses: totals.byStatus }
}

// ─── CSV ────────────────────────────────────────────────────────────────────

const CSV_BOM = '﻿'
const CSV_EOL = '\r\n'

/** Text cells that a spreadsheet would run as a formula get a leading quote. */
function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function decimal(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',')
}

function minutes(seconds: number | null): string {
  return seconds === null ? '' : (seconds / 60).toFixed(1).replace('.', ',')
}

export function agentReportCsvFileName(
  report: Pick<WhatsAppAgentReportDTO, 'fromDay' | 'toDay'>,
): string {
  return `relatorio-atendentes-${report.fromDay}-a-${report.toDay}.csv`
}

/**
 * `;`-separated, UTF-8 with BOM (Excel-BR opens it right): one line per
 * agent plus the total, and one column per close status label.
 */
export function agentReportToCsv(report: WhatsAppAgentReportDTO): string {
  const labels = report.statuses.map((status) => status.label)
  const header = [
    'Atendente',
    'Encerradas',
    'Tabuladas',
    'Sucesso',
    'Insucesso',
    'Taxa de sucesso (%)',
    'Sem tabulação',
    'Tempo médio de atendimento (min)',
    'Em aberto',
    ...labels.map((label) => `Status: ${label}`),
  ]
  const line = (name: string, metrics: WhatsAppAgentReportMetricsDTO) => {
    const counts = new Map(
      metrics.byStatus.map((status) => [status.label, status.count]),
    )
    return [
      csvText(name),
      metrics.closed,
      metrics.tabulated,
      metrics.success,
      metrics.failure,
      decimal(metrics.successRate),
      metrics.untabulated,
      minutes(metrics.avgHandlingSeconds),
      metrics.open,
      ...labels.map((label) => counts.get(label) ?? 0),
    ].join(';')
  }
  const lines = [
    header.map(csvText).join(';'),
    ...report.rows.map((row) => line(row.agentName, row)),
    line('Total', report.totals),
  ]
  return `${CSV_BOM}${lines.join(CSV_EOL)}${CSV_EOL}`
}
