/**
 * Cálculo do risco preditivo de violação de SLA — **lib pura** (ADR 0016).
 *
 * Recebe o recorte de um chamado, as estatísticas do workspace e o instante
 * de referência; devolve os fatores que pegaram (cada um com a frase em
 * pt-BR que a tela mostra), a nota 0–100, a faixa e a previsão de quando o
 * prazo estoura se o ritmo atual seguir.
 *
 * Nada de banco e nada de LLM: a tabela de pesos é `./risk.ts` e o relógio
 * é o de SLA (`./sla.ts`, minutos úteis sobre o calendário de expediente,
 * incluindo a pausa de fase). Quem carrega as linhas e persiste é o
 * `SdRiskService`.
 */

import type { SdPhaseCategory, SdRiskLevelPrediction } from '@prisma/client'
import {
  SD_RISK_FACTOR_SPECS,
  type SdRiskFactorKey,
  type SdRiskFactorResult,
  type SdRiskFactorSpec,
  sdRiskLevel,
  sdRiskScore,
} from './risk'
import {
  addBusinessMinutes,
  computeSlaState,
  SD_CALENDAR_24X7,
  type SdCalendar,
  type SdSlaTicketInput,
  type SdSlaTimer,
} from './sla'

/* ------------------------------------------------------------------ */
/* Cortes da heurística (ajustáveis sem migração — ADR 0016)            */
/* ------------------------------------------------------------------ */

export const SD_RISK_TUNING = {
  /** % do prazo consumido em que o fator começa a pontuar (e onde satura). */
  slaFromPercent: 50,
  slaFullPercent: 100,
  /** Horas sem responsável para o fator saturar. */
  unassignedFullHours: 4,
  /** Horas sem interação da equipe: início da rampa e saturação. */
  staleFromHours: 8,
  staleFullHours: 48,
  /** Reaberturas para o fator saturar. */
  reopenFull: 2,
  /** Fila do time (ou carga do responsável) em múltiplos da média. */
  pressureFullRatio: 2,
} as const

const MINUTE_MS = 60_000

/* ------------------------------------------------------------------ */
/* Entradas                                                             */
/* ------------------------------------------------------------------ */

export interface SdRiskScaleRef {
  name: string
  level: number
}

/** O recorte do chamado que a heurística usa. */
export interface SdRiskTicketInput extends SdSlaTicketInput {
  assigneeId: string | null
  departmentId: string | null
  customerId: string | null
  companyId: string | null
  serviceId: string | null
  reopenCount: number
  /**
   * Última interação **da equipe** (evento de agente: resposta, nota, mudança
   * de campo, tarefa…). Mensagem do cliente não conta: ela pede resposta, não
   * a dá. `null` quando a equipe nunca agiu no chamado — o silêncio conta
   * desde a abertura.
   */
  lastTeamActivityAt: Date | null
  priority: SdRiskScaleRef | null
  severity: SdRiskScaleRef | null
  phase: { name: string; category: SdPhaseCategory; pausesSla: boolean }
}

/**
 * Médias e históricos do próprio workspace — é o que torna "fila cheia" e
 * "responsável sobrecarregado" comparáveis entre clientes de tamanhos
 * diferentes (um time de 3 pessoas não é medido pela régua de um de 30).
 */
export interface SdRiskWorkspaceStats {
  /** Chamados abertos por departamento. */
  openByDepartment: Record<string, number>
  /** Chamados abertos por responsável. */
  openByAssignee: Record<string, number>
  /** Maior `level` das prioridades do workspace (0 quando não há escala). */
  maxPriorityLevel: number
  /** Maior `level` das severidades do workspace. */
  maxSeverityLevel: number
  /** Clientes/empresas que já tiveram prazo violado antes. */
  breachedCustomerIds: Set<string>
  /** Serviços do catálogo que já tiveram prazo violado antes. */
  breachedServiceIds: Set<string>
}

export interface SdRiskOptions {
  /** % do prazo a partir do qual o SLA vira "em risco" (`SdSettings`). */
  atRiskPercent?: number
  /** Calendário de expediente da política de SLA do chamado. */
  calendar?: SdCalendar | null
}

export interface SdRiskPredictionResult {
  level: SdRiskLevelPrediction
  score: number
  factors: SdRiskFactorResult[]
  /** Quando o prazo estoura se o ritmo atual seguir (`null` sem previsão). */
  breachEtaAt: Date | null
}

export function sdRiskEmptyStats(): SdRiskWorkspaceStats {
  return {
    openByDepartment: {},
    openByAssignee: {},
    maxPriorityLevel: 0,
    maxSeverityLevel: 0,
    breachedCustomerIds: new Set(),
    breachedServiceIds: new Set(),
  }
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                           */
/* ------------------------------------------------------------------ */

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return value >= 1 ? 1 : value
}

/**
 * Duração em pt-BR curto ("45 min", "3 h", "2 d") — a frase do fator fala
 * a língua do agente, não minutos corridos.
 */
export function sdRiskDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return `${total} min`
  const hours = Math.round(total / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.round(total / 1440)} d`
}

const SPECS = Object.fromEntries(
  SD_RISK_FACTOR_SPECS.map((spec) => [spec.key, spec]),
) as Record<SdRiskFactorKey, SdRiskFactorSpec>

/** Fator com peso proporcional (0 … peso da tabela) e a frase do porquê. */
function factor(
  key: SdRiskFactorKey,
  ratio: number,
  detail: string,
): SdRiskFactorResult | null {
  const spec = SPECS[key]
  const share = clamp01(ratio)
  if (share === 0) return null
  return {
    key,
    label: spec.label,
    weight: Math.max(1, Math.round(spec.weight * share)),
    detail,
  }
}

/** Rampa linear: 0 em `from`, 1 em `full` (os cortes nunca são iguais). */
function ramp(value: number, from: number, full: number): number {
  return clamp01((value - from) / (full - from))
}

/** Quanto a medida passou da média, em múltiplos (2× média = 1). */
function pressureRatio(value: number, mean: number): number {
  if (mean <= 0 || value <= mean) return 0
  const excess = (value - mean) / mean
  return clamp01(excess / (SD_RISK_TUNING.pressureFullRatio - 1))
}

function average(counts: Record<string, number>): number {
  const values = Object.values(counts)
  if (values.length === 0) return 0
  return values.reduce((sum, n) => sum + n, 0) / values.length
}

/** Posição na escala do workspace (0 … 1); escala sem degraus não pontua. */
function scaleRatio(ref: SdRiskScaleRef | null, max: number): number {
  if (!ref || max <= 1) return 0
  return clamp01((ref.level - 1) / (max - 1))
}

interface SdRiskTimer {
  timer: SdSlaTimer
  label: string
}

/** Relógio que ainda corre (ou já estourou sem conclusão) — o que pesa. */
function isLive(timer: SdSlaTimer): boolean {
  return (
    timer.state === 'ok' ||
    timer.state === 'at_risk' ||
    timer.state === 'breached'
  )
}

/** Quanto o timer pesa: violado vence qualquer porcentagem. */
function urgency(timer: SdSlaTimer): number {
  if (timer.state === 'breached') return Number.POSITIVE_INFINITY
  return timer.percentUsed ?? 0
}

/**
 * Os timers que entram no risco. A resolução entra sempre que tem prazo; a
 * 1ª resposta entra enquanto **ninguém respondeu** — um chamado com 90% do
 * prazo de 1ª resposta gasto está em risco mesmo com a resolução folgada.
 * Sem prazo de resolução, a 1ª resposta segue valendo como antes (inclusive
 * respondida, para o "já violado" de quem respondeu atrasado).
 */
function slaTimers(
  ticket: SdRiskTicketInput,
  now: Date,
  options: SdRiskOptions,
): SdRiskTimer[] {
  const state = computeSlaState(ticket, now, {
    atRiskPercent: options.atRiskPercent,
    calendar: options.calendar ?? SD_CALENDAR_24X7,
  })
  const timers: SdRiskTimer[] = []
  const hasResolution = state.resolution.state !== 'none'
  if (hasResolution) {
    timers.push({ timer: state.resolution, label: 'resolução' })
  }
  if (
    state.firstResponse.state !== 'none' &&
    (!ticket.firstRespondedAt || !hasResolution)
  ) {
    timers.push({ timer: state.firstResponse, label: '1ª resposta' })
  }
  return timers
}

/**
 * Timer que explica o fator `sla_consumed`: o mais urgente entre os que
 * correm (empate fica com a resolução); sem nenhum correndo, o primeiro da
 * lista (pausado ou cumprido, que não pontua).
 */
function drivingTimer(timers: SdRiskTimer[]): SdRiskTimer | null {
  let best: SdRiskTimer | null = null
  for (const candidate of timers) {
    if (!isLive(candidate.timer)) continue
    if (!best || urgency(candidate.timer) > urgency(best.timer))
      best = candidate
  }
  return best ?? timers[0] ?? null
}

/* ------------------------------------------------------------------ */
/* Os nove fatores                                                      */
/* ------------------------------------------------------------------ */

function slaFactor(
  timer: SdSlaTimer,
  label: string,
): SdRiskFactorResult | null {
  if (timer.state === 'none' || timer.state === 'met') return null
  if (timer.state === 'paused') return null
  if (timer.state === 'breached') {
    return factor('sla_consumed', 1, `Prazo de ${label} já violado`)
  }
  // Estado sem prazo já saiu acima: aqui `percentUsed` é sempre número.
  const percent = Number(timer.percentUsed)
  return factor(
    'sla_consumed',
    ramp(percent, SD_RISK_TUNING.slaFromPercent, SD_RISK_TUNING.slaFullPercent),
    `${percent}% do prazo de ${label} consumido (em horário útil)`,
  )
}

function unassignedFactor(
  ticket: SdRiskTicketInput,
  now: Date,
): SdRiskFactorResult | null {
  if (ticket.assigneeId) return null
  const minutes = Math.max(
    0,
    (now.getTime() - ticket.createdAt.getTime()) / MINUTE_MS,
  )
  return factor(
    'unassigned',
    ramp(minutes / 60, 0, SD_RISK_TUNING.unassignedFullHours),
    `Sem responsável há ${sdRiskDuration(minutes)}`,
  )
}

function priorityFactor(
  ticket: SdRiskTicketInput,
  stats: SdRiskWorkspaceStats,
): SdRiskFactorResult | null {
  const priority = scaleRatio(ticket.priority, stats.maxPriorityLevel)
  const severity = scaleRatio(ticket.severity, stats.maxSeverityLevel)
  if (priority === 0 && severity === 0) return null
  const detail =
    priority >= severity && ticket.priority
      ? `Prioridade ${ticket.priority.name}`
      : `Severidade ${ticket.severity?.name}`
  return factor('priority', Math.max(priority, severity), detail)
}

function staleFactor(
  ticket: SdRiskTicketInput,
  now: Date,
): SdRiskFactorResult | null {
  const since = ticket.lastTeamActivityAt ?? ticket.createdAt
  const minutes = (now.getTime() - since.getTime()) / MINUTE_MS
  return factor(
    'stale',
    ramp(
      minutes / 60,
      SD_RISK_TUNING.staleFromHours,
      SD_RISK_TUNING.staleFullHours,
    ),
    `Sem interação da equipe há ${sdRiskDuration(minutes)}`,
  )
}

function reopenedFactor(ticket: SdRiskTicketInput): SdRiskFactorResult | null {
  if (ticket.reopenCount <= 0) return null
  return factor(
    'reopened',
    ramp(ticket.reopenCount, 0, SD_RISK_TUNING.reopenFull),
    ticket.reopenCount === 1
      ? 'Já foi reaberto uma vez'
      : `Já foi reaberto ${ticket.reopenCount} vezes`,
  )
}

function queueFactor(
  ticket: SdRiskTicketInput,
  stats: SdRiskWorkspaceStats,
): SdRiskFactorResult | null {
  if (!ticket.departmentId) return null
  const open = stats.openByDepartment[ticket.departmentId] ?? 0
  const mean = average(stats.openByDepartment)
  const ratio = pressureRatio(open, mean)
  if (ratio === 0) return null
  return factor(
    'queue_pressure',
    ratio,
    `Fila do time com ${open} chamados abertos (média do workspace: ${Math.round(mean)})`,
  )
}

function waitingFactor(ticket: SdRiskTicketInput): SdRiskFactorResult | null {
  if (ticket.phase.category !== 'WAITING') return null
  if (ticket.phase.pausesSla) return null
  return factor(
    'waiting_third_party',
    1,
    `Em "${ticket.phase.name}" com o prazo correndo`,
  )
}

function loadFactor(
  ticket: SdRiskTicketInput,
  stats: SdRiskWorkspaceStats,
): SdRiskFactorResult | null {
  if (!ticket.assigneeId) return null
  const open = stats.openByAssignee[ticket.assigneeId] ?? 0
  const mean = average(stats.openByAssignee)
  const ratio = pressureRatio(open, mean)
  if (ratio === 0) return null
  return factor(
    'assignee_load',
    ratio,
    `Responsável com ${open} chamados abertos (média: ${Math.round(mean)})`,
  )
}

function historyFactor(
  ticket: SdRiskTicketInput,
  stats: SdRiskWorkspaceStats,
): SdRiskFactorResult | null {
  const customerId = ticket.customerId ?? ticket.companyId
  const customer = customerId
    ? stats.breachedCustomerIds.has(customerId)
    : false
  const service = ticket.serviceId
    ? stats.breachedServiceIds.has(ticket.serviceId)
    : false
  if (!customer && !service) return null
  const detail =
    customer && service
      ? 'Este cliente e este serviço já tiveram prazo violado antes'
      : customer
        ? 'Este cliente já teve prazo violado antes'
        : 'Este serviço já teve prazo violado antes'
  return factor('history', customer && service ? 1 : 0.5, detail)
}

/* ------------------------------------------------------------------ */
/* Previsão                                                             */
/* ------------------------------------------------------------------ */

/**
 * Quando o prazo estoura se o ritmo atual seguir: consome os minutos úteis
 * restantes a partir de agora **no calendário de expediente**, de modo que
 * 30 minutos úteis às 17h50 de uma sexta caem na segunda de manhã. Prazo já
 * violado devolve a data do prazo; relógio pausado não tem previsão.
 */
export function sdRiskBreachEta(
  timer: SdSlaTimer,
  now: Date,
  calendar: SdCalendar,
): Date | null {
  if (timer.state === 'none' || timer.state === 'met') return null
  if (timer.state === 'paused') return null
  if (!timer.dueAt) return null
  if (timer.state === 'breached') return new Date(timer.dueAt)
  const remaining = timer.remainingMinutes
  if (remaining === null) return null
  if (remaining <= 0) return new Date(timer.dueAt)
  return addBusinessMinutes(now, remaining, calendar)
}

/**
 * Previsão do chamado: o **primeiro** prazo a estourar entre os timers que
 * entram no risco — a 1ª resposta vence em 1 h mesmo quando a resolução
 * ainda tem um dia.
 */
function earliestBreachEta(
  timers: SdRiskTimer[],
  now: Date,
  calendar: SdCalendar,
): Date | null {
  let earliest: Date | null = null
  for (const { timer } of timers) {
    const eta = sdRiskBreachEta(timer, now, calendar)
    if (eta && (!earliest || eta.getTime() < earliest.getTime())) earliest = eta
  }
  return earliest
}

/**
 * Nota, faixa, fatores e previsão de estouro de um chamado. Cada fator que
 * pega soma entre 1 e o seu peso e leva a frase que a interface mostra —
 * selo sem motivo é bug (ADR 0016).
 */
export function computeSdRiskPrediction(
  ticket: SdRiskTicketInput,
  stats: SdRiskWorkspaceStats,
  now: Date = new Date(),
  options: SdRiskOptions = {},
): SdRiskPredictionResult {
  const calendar = options.calendar ?? SD_CALENDAR_24X7
  const timers = slaTimers(ticket, now, options)
  const driving = drivingTimer(timers)
  const factors = [
    driving ? slaFactor(driving.timer, driving.label) : null,
    unassignedFactor(ticket, now),
    priorityFactor(ticket, stats),
    staleFactor(ticket, now),
    reopenedFactor(ticket),
    queueFactor(ticket, stats),
    waitingFactor(ticket),
    loadFactor(ticket, stats),
    historyFactor(ticket, stats),
  ].filter((f): f is SdRiskFactorResult => f !== null)

  const score = sdRiskScore(factors)
  return {
    level: sdRiskLevel(score),
    score,
    factors,
    breachEtaAt: earliestBreachEta(timers, now, calendar),
  }
}
