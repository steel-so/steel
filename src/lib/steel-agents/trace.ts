import { PII_KINDS, type PiiCounts } from '@/src/lib/ai/guardrails/pii'

/**
 * Run trace helpers (A4 — "why" of each execution). A guardrail that fires
 * during a run becomes a GUARDRAIL step, so the timeline shows which rule
 * acted, when and with what effect. Pure functions: the runner feeds them
 * the guard report of the prepared call.
 */

export const GUARDRAIL_RULES = [
  'PROMPT_INJECTION',
  'PII_MASKED',
  'MODEL_FAILOVER',
  'AUTO_NEEDS_APPROVAL',
  'DELETE_NEEDS_APPROVAL',
  'ROUND_LIMIT',
  'TOOL_NOT_ALLOWED',
  'AUTO_ROLE_RESTRICTED',
  'DELEGATION_REFUSED',
  'KILL_SWITCH',
] as const

export type GuardrailRule = (typeof GUARDRAIL_RULES)[number]

/** pt-BR title of each rule (shown in the run timeline). */
export const GUARDRAIL_RULE_LABEL: Record<GuardrailRule, string> = {
  PROMPT_INJECTION: 'Instrução suspeita em conteúdo de terceiros',
  PII_MASKED: 'Dados pessoais mascarados',
  MODEL_FAILOVER: 'Troca de modelo por falha do provedor',
  AUTO_NEEDS_APPROVAL: 'Escrita automática enviada para aprovação',
  DELETE_NEEDS_APPROVAL: 'Exclusão sempre exige aprovação',
  ROUND_LIMIT: 'Limite de etapas da execução atingido',
  TOOL_NOT_ALLOWED: 'Ferramenta fora da lista do agente',
  AUTO_ROLE_RESTRICTED: 'Perfil do responsável não libera o modo automático',
  DELEGATION_REFUSED: 'Delegação recusada',
  KILL_SWITCH: 'Agentes pausados por emergência',
}

export const PII_KIND_LABEL: Record<(typeof PII_KINDS)[number], string> = {
  EMAIL: 'e-mail',
  CNPJ: 'CNPJ',
  CPF: 'CPF',
  CARD: 'cartão',
  PHONE: 'telefone',
}

/** Shape stored in `output` of a GUARDRAIL step. */
export interface GuardrailStepOutput {
  rule: GuardrailRule
  /** Short pt-BR explanation of what happened in this run. */
  detail: string
  [key: string]: unknown
}

export function guardrailOutput(
  rule: GuardrailRule,
  detail: string,
  extra: Record<string, unknown> = {},
): GuardrailStepOutput {
  return { ...extra, rule, detail }
}

/** What the guard report looked like when last inspected. */
export interface GuardSnapshot {
  piiCounts: PiiCounts
  injectionSources: number
  failovers: number
}

interface GuardReportLike {
  piiCounts: PiiCounts
  injection: { detected: boolean; signals: string[]; sources: string[] }
  failovers: { from: string; to: string; reason: string }[]
}

export function snapshotGuard(
  report: GuardReportLike | undefined,
): GuardSnapshot {
  return {
    piiCounts: { ...(report?.piiCounts ?? emptyCounts()) },
    injectionSources: report?.injection.sources.length ?? 0,
    failovers: report?.failovers.length ?? 0,
  }
}

function emptyCounts(): PiiCounts {
  return { EMAIL: 0, CNPJ: 0, CPF: 0, CARD: 0, PHONE: 0 }
}

/**
 * Guardrail events that happened since `previous`. Returns the new snapshot
 * to carry to the next inspection.
 */
export function diffGuard(
  previous: GuardSnapshot,
  report: GuardReportLike | undefined,
): { events: GuardrailStepOutput[]; snapshot: GuardSnapshot } {
  const snapshot = snapshotGuard(report)
  const events: GuardrailStepOutput[] = []
  if (!report) return { events, snapshot }

  const newSources = report.injection.sources.slice(previous.injectionSources)
  if (newSources.length > 0) {
    events.push(
      guardrailOutput(
        'PROMPT_INJECTION',
        'O texto de uma consulta tentou dar ordens ao agente. Ele foi tratado como dado e escritas automáticas passaram a exigir aprovação nesta execução.',
        { sources: newSources, signals: report.injection.signals },
      ),
    )
  }

  const masked = PII_KINDS.filter(
    (kind) => report.piiCounts[kind] > previous.piiCounts[kind],
  )
  if (masked.length > 0) {
    const counts = Object.fromEntries(
      masked.map((kind) => [
        kind,
        report.piiCounts[kind] - previous.piiCounts[kind],
      ]),
    )
    const text = masked
      .map((kind) => `${counts[kind]} ${PII_KIND_LABEL[kind]}`)
      .join(', ')
    events.push(
      guardrailOutput(
        'PII_MASKED',
        `Antes de ir ao modelo, foram mascarados: ${text}.`,
        { counts },
      ),
    )
  }

  for (const failover of report.failovers.slice(previous.failovers)) {
    events.push(
      guardrailOutput(
        'MODEL_FAILOVER',
        `O modelo ${failover.from} falhou (${failover.reason}); a execução seguiu com ${failover.to}.`,
        { from: failover.from, to: failover.to, reason: failover.reason },
      ),
    )
  }
  return { events, snapshot }
}

/** Max characters of a tool result kept as the "retrieved context". */
export const CONTEXT_EXCERPT_LIMIT = 2_000

export function contextExcerpt(content: string): {
  excerpt: string
  truncated: boolean
} {
  if (content.length <= CONTEXT_EXCERPT_LIMIT) {
    return { excerpt: content, truncated: false }
  }
  return { excerpt: content.slice(0, CONTEXT_EXCERPT_LIMIT), truncated: true }
}
