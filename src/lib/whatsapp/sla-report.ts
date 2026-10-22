import type { WhatsAppSlaReportRow } from '@/src/repositories/whatsapp-sla-cycle.repository'
import type {
  WhatsAppSlaBreakdownRowDTO,
  WhatsAppSlaReportDTO,
} from '@/types/whatsapp-sla'

/**
 * Pure aggregation of the SLA report (ADR 0048).
 *
 * A first-response target is *evaluated* once it was answered or its
 * deadline passed; a cycle closed before the deadline without an answer is
 * not evaluated (nobody failed). Same for resolution. "Within target" means
 * the event happened at or before the deadline.
 */

export type SlaReportSummary = Pick<
  WhatsAppSlaReportDTO,
  'firstResponse' | 'resolution' | 'byAgent' | 'byTeam'
>

interface Evaluation {
  evaluated: boolean
  within: boolean
}

function evaluateFirstResponse(
  row: WhatsAppSlaReportRow,
  now: Date,
): Evaluation {
  if (row.firstResponseAt) {
    return {
      evaluated: true,
      within: row.firstResponseAt <= row.firstResponseDueAt,
    }
  }
  const closedEarly = row.resolvedAt && row.resolvedAt < row.firstResponseDueAt
  if (closedEarly) return { evaluated: false, within: false }
  return { evaluated: row.firstResponseDueAt <= now, within: false }
}

function evaluateResolution(row: WhatsAppSlaReportRow, now: Date): Evaluation {
  if (!row.resolutionDueAt) return { evaluated: false, within: false }
  if (row.resolvedAt) {
    return { evaluated: true, within: row.resolvedAt <= row.resolutionDueAt }
  }
  return { evaluated: row.resolutionDueAt <= now, within: false }
}

/** Nearest-rank percentile of an unsorted list; null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

function percent(within: number, evaluated: number): number | null {
  return evaluated === 0 ? null : Math.round((within / evaluated) * 1000) / 10
}

function bump(
  map: Map<string | null, WhatsAppSlaBreakdownRowDTO>,
  id: string | null,
  labels: Map<string, string>,
  fallback: string,
  breached: boolean,
) {
  const current = map.get(id) ?? {
    id,
    label: id ? (labels.get(id) ?? 'Removido') : fallback,
    cycles: 0,
    breaches: 0,
  }
  current.cycles += 1
  if (breached) current.breaches += 1
  map.set(id, current)
}

function sortBreakdown(map: Map<string | null, WhatsAppSlaBreakdownRowDTO>) {
  return [...map.values()].sort(
    (a, b) =>
      b.breaches - a.breaches ||
      b.cycles - a.cycles ||
      a.label.localeCompare(b.label, 'pt-BR'),
  )
}

export function summarizeSlaCycles(input: {
  rows: WhatsAppSlaReportRow[]
  now: Date
  agentLabels: Map<string, string>
  teamLabels: Map<string, string>
}): SlaReportSummary {
  let frEvaluated = 0
  let frWithin = 0
  let resEvaluated = 0
  let resWithin = 0
  const answeredSeconds: number[] = []
  const agents = new Map<string | null, WhatsAppSlaBreakdownRowDTO>()
  const teams = new Map<string | null, WhatsAppSlaBreakdownRowDTO>()

  for (const row of input.rows) {
    const first = evaluateFirstResponse(row, input.now)
    const resolution = evaluateResolution(row, input.now)
    if (first.evaluated) {
      frEvaluated += 1
      if (first.within) frWithin += 1
    }
    if (resolution.evaluated) {
      resEvaluated += 1
      if (resolution.within) resWithin += 1
    }
    if (row.firstResponseAt && row.firstResponseSeconds !== null) {
      answeredSeconds.push(row.firstResponseSeconds)
    }
    if (first.evaluated || resolution.evaluated) {
      const breached =
        (first.evaluated && !first.within) ||
        (resolution.evaluated && !resolution.within)
      bump(
        agents,
        row.agentUserId,
        input.agentLabels,
        'Sem responsável',
        breached,
      )
      bump(teams, row.teamId, input.teamLabels, 'Sem equipe', breached)
    }
  }

  const average =
    answeredSeconds.length === 0
      ? null
      : Math.round(
          answeredSeconds.reduce((sum, value) => sum + value, 0) /
            answeredSeconds.length,
        )

  return {
    firstResponse: {
      evaluated: frEvaluated,
      withinTarget: frWithin,
      withinPercent: percent(frWithin, frEvaluated),
      averageSeconds: average,
      p90Seconds: percentile(answeredSeconds, 90),
    },
    resolution: {
      evaluated: resEvaluated,
      withinTarget: resWithin,
      withinPercent: percent(resWithin, resEvaluated),
    },
    byAgent: sortBreakdown(agents),
    byTeam: sortBreakdown(teams),
  }
}
