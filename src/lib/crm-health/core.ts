/**
 * Shared scoring design of the CRM health scores: T4 (customer churn risk) and
 * C4 (opportunity risk) are the same heuristic at two scales.
 *
 * It follows the predictive risk of ServiceDesk (ADR 0016): an explainable
 * table of factors with fixed weights summing 100, the same two cuts
 * (`SD_RISK_THRESHOLDS`) and a pt-BR sentence per factor that scored. No model
 * and no LLM. The score is a **risk** (0-100, higher = worse); the customer
 * screen shows `100 - risk` as "saúde".
 *
 * A factor can be *not applicable* (e.g. the customer has no WhatsApp
 * conversation): it leaves the denominator, so a missing source never makes a
 * customer look healthier or sicker than the data supports.
 */

import type { CrmHealthLevel } from '@prisma/client'
import { SD_RISK_THRESHOLDS } from '@/src/lib/servicedesk/risk'

export interface HealthFactorSpec<K extends string = string> {
  key: K
  label: string
  /** Maximum points the factor can add. All specs of a table sum 100. */
  weight: number
}

/** What one factor produced for one record. */
export interface HealthFactorOutcome<K extends string = string> {
  key: K
  /** `false` = no data for this factor; it leaves the denominator. */
  applicable: boolean
  /** Share of the weight that scored, 0-1 (clamped). */
  ratio: number
  /** Sentence in pt-BR shown to the user ("Sem contato há 45 dias"). */
  detail: string
}

/** A factor that scored, as persisted and shown. */
export interface HealthFactorResult {
  key: string
  label: string
  /** Points added to the risk. */
  points: number
  /** The most it could add (its weight). */
  max: number
  detail: string
}

export interface HealthNextAction {
  key: string
  label: string
  detail: string
}

export interface HealthComputation {
  riskScore: number
  level: CrmHealthLevel
  factors: HealthFactorResult[]
  /** Labels of the factors skipped because there was no data. */
  missing: string[]
  nextAction: HealthNextAction
}

export const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, value))

/** Linear ramp: 0 at `from`, 1 at `to` (works when `to < from` too). */
export function ramp(value: number, from: number, to: number): number {
  if (from === to) return value >= to ? 1 : 0
  return clamp01((value - from) / (to - from))
}

/** Whole days between two instants (never negative). */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000))
}

/** "1 dia" / "12 dias". */
export function pluralDays(days: number): string {
  return days === 1 ? '1 dia' : `${days} dias`
}

/** Band of a risk score; the same cuts as the ServiceDesk risk (ADR 0016). */
export function healthLevel(riskScore: number): CrmHealthLevel {
  if (riskScore >= SD_RISK_THRESHOLDS.high) return 'HIGH'
  if (riskScore >= SD_RISK_THRESHOLDS.medium) return 'MEDIUM'
  return 'LOW'
}

/** Labels of the bands in pt-BR. */
export const HEALTH_LEVEL_LABEL: Record<CrmHealthLevel, string> = {
  LOW: 'Risco baixo',
  MEDIUM: 'Risco médio',
  HIGH: 'Risco alto',
}

/** The table must sum 100 so the score reads as a percentage (tested). */
export function totalWeight(specs: readonly HealthFactorSpec[]): number {
  return specs.reduce((sum, spec) => sum + spec.weight, 0)
}

/**
 * Sums the outcomes into a 0-100 risk. Only applicable factors count in the
 * denominator; when every factor is applicable this is the plain sum of the
 * points. Returns the factors that scored (largest first, ties by table
 * order) and the labels of the skipped ones.
 */
export function scoreFactors(
  specs: readonly HealthFactorSpec[],
  outcomes: readonly HealthFactorOutcome[],
): { riskScore: number; factors: HealthFactorResult[]; missing: string[] } {
  const byKey = new Map(outcomes.map((outcome) => [outcome.key, outcome]))
  const factors: HealthFactorResult[] = []
  const missing: string[] = []
  let points = 0
  let applicableWeight = 0

  for (const spec of specs) {
    const outcome = byKey.get(spec.key)
    if (!outcome?.applicable) {
      missing.push(spec.label)
      continue
    }
    applicableWeight += spec.weight
    const earned = spec.weight * clamp01(outcome.ratio)
    points += earned
    if (earned > 0) {
      factors.push({
        key: spec.key,
        label: spec.label,
        points: Math.round(earned * 10) / 10,
        max: spec.weight,
        detail: outcome.detail,
      })
    }
  }

  const riskScore =
    applicableWeight === 0
      ? 0
      : Math.min(100, Math.round((points / applicableWeight) * 100))
  // Array#sort is stable: equal points keep the table order.
  factors.sort((a, b) => b.points - a.points)
  return { riskScore, factors, missing }
}

/**
 * Next best action: the action of the factor that scored the most. With no
 * factor at all the account is fine, so the action is to keep nurturing it.
 */
export function pickNextAction(
  factors: readonly HealthFactorResult[],
  actions: Readonly<Record<string, HealthNextAction>>,
  fallback: HealthNextAction,
): HealthNextAction {
  for (const factor of factors) {
    const action = actions[factor.key]
    if (action) return action
  }
  return fallback
}

export function buildHealth(
  specs: readonly HealthFactorSpec[],
  outcomes: readonly HealthFactorOutcome[],
  actions: Readonly<Record<string, HealthNextAction>>,
  fallback: HealthNextAction,
): HealthComputation {
  const scored = scoreFactors(specs, outcomes)
  return {
    riskScore: scored.riskScore,
    level: healthLevel(scored.riskScore),
    factors: scored.factors,
    missing: scored.missing,
    nextAction: pickNextAction(scored.factors, actions, fallback),
  }
}

/**
 * Should a recompute raise an alert? Yes when the record **enters** the high
 * band, or when it is at least medium and the risk jumped by `jump` points
 * since the previous computation. Never on the first computation of a record
 * that is not high (nothing to compare), and never twice for the same state.
 */
export function shouldAlertHealth(input: {
  level: CrmHealthLevel
  riskScore: number
  previousLevel: CrmHealthLevel | null
  previousScore: number | null
  jump: number
}): boolean {
  if (input.level === 'HIGH' && input.previousLevel !== 'HIGH') return true
  if (input.level === 'LOW' || input.previousScore === null) return false
  return input.riskScore - input.previousScore >= input.jump
}
