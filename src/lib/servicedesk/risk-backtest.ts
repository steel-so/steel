/**
 * Backtest do risco preditivo — **lib pura** (ADR 0016, atualização de
 * 2026-10-18).
 *
 * Reproduz a heurística de `./risk-compute.ts` sobre chamados **encerrados**
 * com desfecho de SLA conhecido: para cada chamado, tira fotos em instantes
 * antes do desfecho (25%, 50% e 75% do caminho até a violação ou o
 * encerramento), monta o recorte que a heurística teria visto naquele
 * instante e compara a faixa prevista com o que aconteceu de fato.
 *
 * Saem três medidas:
 * - **calibração por faixa** — taxa real de violação entre as fotos de cada
 *   faixa (BAIXO deve violar pouco, ALTO muito);
 * - **precisão e revocação da faixa alta** — tratando "ALTO" como o alarme;
 * - **antecedência** — quanto tempo antes da violação o chamado entrou na
 *   faixa alta pela primeira vez.
 *
 * A reconstrução é aproximada (o histórico completo do chamado não é
 * versionado): fase e pausa de SLA não são reproduzidas (a foto assume fase
 * em andamento com o relógio correndo); o responsável conta a partir da
 * primeira atribuição registrada; filas e carga são reconstruídas só com os
 * chamados da amostra. O script `scripts/risk-backtest.ts` carrega as linhas;
 * aqui só há cálculo.
 */

import type { SdRiskLevelPrediction } from '@prisma/client'
import {
  computeSdRiskPrediction,
  type SdRiskScaleRef,
  type SdRiskTicketInput,
  type SdRiskWorkspaceStats,
  sdRiskEmptyStats,
} from './risk-compute'
import type { SdCalendar } from './sla'

/** Em que pontos do caminho até o desfecho a heurística é reproduzida. */
export const SD_RISK_BACKTEST_FRACTIONS = [0.25, 0.5, 0.75] as const

const MINUTE_MS = 60_000

const LEVELS: SdRiskLevelPrediction[] = ['LOW', 'MEDIUM', 'HIGH']

/** Chamado encerrado com o que dá para reconstruir do histórico. */
export interface SdRiskBacktestTicket {
  id: string
  createdAt: Date
  firstResponseDueAt: Date | null
  resolutionDueAt: Date | null
  firstRespondedAt: Date | null
  resolvedAt: Date | null
  closedAt: Date | null
  firstResponseBreached: boolean
  resolutionBreached: boolean
  assigneeId: string | null
  /** Primeira atribuição registrada (`null` = desde a abertura). */
  assignedAt: Date | null
  departmentId: string | null
  customerId: string | null
  companyId: string | null
  serviceId: string | null
  priority: SdRiskScaleRef | null
  severity: SdRiskScaleRef | null
  /** Instantes dos eventos de agente, em qualquer ordem. */
  teamActivityAt: Date[]
  /** Instantes das reaberturas, em qualquer ordem. */
  reopenedAt: Date[]
  calendar: SdCalendar | null
}

export interface SdRiskBacktestOutcome {
  breached: boolean
  /** Primeiro prazo violado (`null` quando cumpriu tudo). */
  breachAt: Date | null
  /** Quando o chamado saiu do relógio (resolvido ou fechado). */
  endAt: Date
}

export interface SdRiskBacktestSample {
  ticketId: string
  at: Date
  level: SdRiskLevelPrediction
  score: number
  breached: boolean
  breachAt: Date | null
}

export interface SdRiskBacktestBand {
  level: SdRiskLevelPrediction
  samples: number
  breached: number
  /** Taxa real de violação na faixa (0–1; `null` sem amostra). */
  breachRate: number | null
  meanScore: number | null
}

export interface SdRiskBacktestLeadTime {
  /** Chamados violados que passaram pela faixa alta antes da violação. */
  caught: number
  /** Chamados violados na amostra. */
  breachedTickets: number
  minMinutes: number | null
  medianMinutes: number | null
  meanMinutes: number | null
  maxMinutes: number | null
}

export interface SdRiskBacktestReport {
  tickets: number
  samples: number
  breachedTickets: number
  bands: SdRiskBacktestBand[]
  /** Faixa alta como alarme, por foto. */
  high: {
    truePositives: number
    falsePositives: number
    falseNegatives: number
    trueNegatives: number
    precision: number | null
    recall: number | null
  }
  leadTime: SdRiskBacktestLeadTime
}

/* ------------------------------------------------------------------ */
/* Desfecho e reconstrução                                              */
/* ------------------------------------------------------------------ */

function minDate(dates: (Date | null)[]): Date | null {
  let out: Date | null = null
  for (const d of dates) {
    if (d && (!out || d.getTime() < out.getTime())) out = d
  }
  return out
}

/**
 * O que aconteceu com o SLA do chamado: violou quando a flag foi gravada ou
 * quando a conclusão passou do prazo (ou nunca houve 1ª resposta e o prazo
 * dela venceu antes do encerramento). `null` quando não há desfecho
 * conhecido — sem prazo nenhum, ou sem data de encerramento.
 */
export function sdRiskBacktestOutcome(
  t: SdRiskBacktestTicket,
): SdRiskBacktestOutcome | null {
  if (!t.firstResponseDueAt && !t.resolutionDueAt) return null
  const endAt = t.resolvedAt ?? t.closedAt
  if (!endAt) return null

  const firstDone = t.firstRespondedAt ?? endAt
  const firstLate =
    t.firstResponseDueAt !== null &&
    (t.firstResponseBreached ||
      firstDone.getTime() > t.firstResponseDueAt.getTime())
  const resolutionLate =
    t.resolutionDueAt !== null &&
    (t.resolutionBreached || endAt.getTime() > t.resolutionDueAt.getTime())

  const breachAt = minDate([
    firstLate ? t.firstResponseDueAt : null,
    resolutionLate ? t.resolutionDueAt : null,
  ])
  return { breached: breachAt !== null, breachAt, endAt }
}

/** Instantes das fotos: antes da violação (ou do encerramento). */
export function sdRiskBacktestInstants(
  t: Pick<SdRiskBacktestTicket, 'createdAt'>,
  outcome: SdRiskBacktestOutcome,
  fractions: readonly number[] = SD_RISK_BACKTEST_FRACTIONS,
): Date[] {
  const horizon = outcome.breachAt ?? outcome.endAt
  const span = horizon.getTime() - t.createdAt.getTime()
  if (span < MINUTE_MS) return []
  return fractions.map((f) => new Date(t.createdAt.getTime() + span * f))
}

function lastBefore(dates: Date[], at: Date): Date | null {
  let out: Date | null = null
  for (const d of dates) {
    if (d.getTime() > at.getTime()) continue
    if (!out || d.getTime() > out.getTime()) out = d
  }
  return out
}

/** O recorte que a heurística teria visto no instante `at`. */
export function sdRiskSnapshotInput(
  t: SdRiskBacktestTicket,
  at: Date,
): SdRiskTicketInput {
  const responded =
    t.firstRespondedAt && t.firstRespondedAt.getTime() <= at.getTime()
      ? t.firstRespondedAt
      : null
  const assigned =
    t.assigneeId !== null &&
    (t.assignedAt === null || t.assignedAt.getTime() <= at.getTime())
  return {
    createdAt: t.createdAt,
    firstResponseDueAt: t.firstResponseDueAt,
    resolutionDueAt: t.resolutionDueAt,
    firstRespondedAt: responded,
    resolvedAt: null,
    slaPausedAt: null,
    slaPausedMinutes: 0,
    firstResponseBreached: false,
    resolutionBreached: false,
    assigneeId: assigned ? t.assigneeId : null,
    departmentId: t.departmentId,
    customerId: t.customerId,
    companyId: t.companyId,
    serviceId: t.serviceId,
    reopenCount: t.reopenedAt.filter((d) => d.getTime() <= at.getTime()).length,
    lastTeamActivityAt: lastBefore(t.teamActivityAt, at),
    priority: t.priority,
    severity: t.severity,
    phase: { name: 'Em andamento', category: 'IN_PROGRESS', pausesSla: false },
  }
}

interface Resolved {
  ticket: SdRiskBacktestTicket
  outcome: SdRiskBacktestOutcome
}

/**
 * Régua do workspace no instante `at`, reconstruída com a amostra: filas e
 * carga contam os chamados abertos naquele instante; histórico de violação
 * conta quem violou antes dele.
 */
export function sdRiskSnapshotStats(
  resolved: Resolved[],
  at: Date,
  scales: { priority: number; severity: number },
): SdRiskWorkspaceStats {
  const stats = sdRiskEmptyStats()
  stats.maxPriorityLevel = scales.priority
  stats.maxSeverityLevel = scales.severity
  const time = at.getTime()
  for (const { ticket, outcome } of resolved) {
    const open =
      ticket.createdAt.getTime() <= time && outcome.endAt.getTime() > time
    if (open && ticket.departmentId) {
      stats.openByDepartment[ticket.departmentId] =
        (stats.openByDepartment[ticket.departmentId] ?? 0) + 1
    }
    if (open && ticket.assigneeId) {
      stats.openByAssignee[ticket.assigneeId] =
        (stats.openByAssignee[ticket.assigneeId] ?? 0) + 1
    }
    if (outcome.breachAt && outcome.breachAt.getTime() < time) {
      const customer = ticket.customerId ?? ticket.companyId
      if (customer) stats.breachedCustomerIds.add(customer)
      if (ticket.serviceId) stats.breachedServiceIds.add(ticket.serviceId)
    }
  }
  return stats
}

/** Roda a heurística em cada foto de cada chamado com desfecho conhecido. */
export function sdRiskBacktestSamples(
  tickets: SdRiskBacktestTicket[],
  options: {
    scales: { priority: number; severity: number }
    atRiskPercent?: number
    fractions?: readonly number[]
  },
): { samples: SdRiskBacktestSample[]; tickets: number } {
  const resolved: Resolved[] = []
  for (const ticket of tickets) {
    const outcome = sdRiskBacktestOutcome(ticket)
    if (outcome) resolved.push({ ticket, outcome })
  }
  const samples: SdRiskBacktestSample[] = []
  for (const { ticket, outcome } of resolved) {
    for (const at of sdRiskBacktestInstants(
      ticket,
      outcome,
      options.fractions,
    )) {
      const prediction = computeSdRiskPrediction(
        sdRiskSnapshotInput(ticket, at),
        sdRiskSnapshotStats(resolved, at, options.scales),
        at,
        { atRiskPercent: options.atRiskPercent, calendar: ticket.calendar },
      )
      samples.push({
        ticketId: ticket.id,
        at,
        level: prediction.level,
        score: prediction.score,
        breached: outcome.breached,
        breachAt: outcome.breachAt,
      })
    }
  }
  return { samples, tickets: resolved.length }
}

/* ------------------------------------------------------------------ */
/* Métricas                                                             */
/* ------------------------------------------------------------------ */

function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den
}

/** Mediana de uma lista (média dos dois do meio quando é par). */
export function sdMedian(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Calibração por faixa, precisão/revocação da faixa alta (por foto) e
 * antecedência (por chamado: da primeira foto ALTO até a violação).
 */
export function sdRiskBacktestMetrics(
  samples: SdRiskBacktestSample[],
  tickets: number = new Set(samples.map((s) => s.ticketId)).size,
): SdRiskBacktestReport {
  const bands = LEVELS.map((level): SdRiskBacktestBand => {
    const inBand = samples.filter((s) => s.level === level)
    const breached = inBand.filter((s) => s.breached).length
    const scoreSum = inBand.reduce((sum, s) => sum + s.score, 0)
    return {
      level,
      samples: inBand.length,
      breached,
      breachRate: ratio(breached, inBand.length),
      meanScore: ratio(scoreSum, inBand.length),
    }
  })

  let tp = 0
  let fp = 0
  let fn = 0
  let tn = 0
  for (const s of samples) {
    const alarm = s.level === 'HIGH'
    if (alarm && s.breached) tp++
    else if (alarm) fp++
    else if (s.breached) fn++
    else tn++
  }

  const firstHigh = new Map<string, SdRiskBacktestSample>()
  const breachedIds = new Set<string>()
  for (const s of samples) {
    if (!s.breached || !s.breachAt) continue
    breachedIds.add(s.ticketId)
    if (s.level !== 'HIGH') continue
    const seen = firstHigh.get(s.ticketId)
    if (!seen || s.at.getTime() < seen.at.getTime())
      firstHigh.set(s.ticketId, s)
  }
  const leads = [...firstHigh.values()].map(
    (s) => ((s.breachAt as Date).getTime() - s.at.getTime()) / MINUTE_MS,
  )

  return {
    tickets,
    samples: samples.length,
    breachedTickets: breachedIds.size,
    bands,
    high: {
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      trueNegatives: tn,
      precision: ratio(tp, tp + fp),
      recall: ratio(tp, tp + fn),
    },
    leadTime: {
      caught: leads.length,
      breachedTickets: breachedIds.size,
      minMinutes: leads.length ? Math.min(...leads) : null,
      medianMinutes: sdMedian(leads),
      meanMinutes: ratio(
        leads.reduce((sum, n) => sum + n, 0),
        leads.length,
      ),
      maxMinutes: leads.length ? Math.max(...leads) : null,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Relatório em texto                                                   */
/* ------------------------------------------------------------------ */

const BAND_LABEL: Record<SdRiskLevelPrediction, string> = {
  LOW: 'baixo',
  MEDIUM: 'médio',
  HIGH: 'alto',
}

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

function hours(minutes: number | null): string {
  return minutes === null ? '—' : `${(minutes / 60).toFixed(1)} h`
}

/** O relatório que o script imprime (pt-BR: quem lê é o time). */
export function formatSdRiskBacktestReport(
  report: SdRiskBacktestReport,
  title: string,
): string {
  const lines = [
    `Backtest do risco preditivo — ${title}`,
    `Chamados com desfecho conhecido: ${report.tickets} (violados: ${report.breachedTickets}) · fotos: ${report.samples}`,
    '',
    'Calibração por faixa (taxa real de violação):',
    ...report.bands.map(
      (b) =>
        `  ${BAND_LABEL[b.level].padEnd(6)} ${String(b.samples).padStart(6)} fotos · ${String(b.breached).padStart(6)} violadas · ${percent(b.breachRate).padStart(6)} · nota média ${b.meanScore === null ? '—' : b.meanScore.toFixed(1)}`,
    ),
    '',
    'Faixa alta como alarme (por foto):',
    `  precisão ${percent(report.high.precision)} · revocação ${percent(report.high.recall)} (VP ${report.high.truePositives} · FP ${report.high.falsePositives} · FN ${report.high.falseNegatives} · VN ${report.high.trueNegatives})`,
    '',
    'Antecedência (primeira foto em alto → violação):',
    `  ${report.leadTime.caught} de ${report.leadTime.breachedTickets} chamados violados passaram pelo alto antes · mínima ${hours(report.leadTime.minMinutes)} · mediana ${hours(report.leadTime.medianMinutes)} · média ${hours(report.leadTime.meanMinutes)} · máxima ${hours(report.leadTime.maxMinutes)}`,
  ]
  return lines.join('\n')
}
