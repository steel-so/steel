import type { SteelAgentRunStepDTO } from '@/types/steel-agent'

/** View model of the run trace ("why" of an execution). Pure, testable. */

export interface TraceContext {
  excerpt: string
  truncated: boolean
}

export interface TraceEntry {
  id: string
  kind: SteelAgentRunStepDTO['kind']
  title: string
  status: SteelAgentRunStepDTO['status']
  createdAt: string
  /** Main text: model reasoning, tool summary, guardrail explanation. */
  body: string | null
  /** Tool arguments, pretty-printed. */
  input: string | null
  /** Retrieved context of a READ tool (owner/admin only). */
  context: TraceContext | null
  /** Rodada number of a MODEL step. */
  round: number | null
  /** Tokens of a MODEL step. */
  tokens: number | null
  /** Tools a MODEL step asked for. */
  toolCalls: string[]
  rule: string | null
  /** A7: run started by a delegation (TOOL step of `delegate_to_agent`). */
  child: { agentId: string; runId: string; agentName: string | null } | null
}

export interface TraceSummary {
  rounds: number
  tools: number
  guardrails: number
  approvals: number
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

function prettyInput(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'object' && Object.keys(value as object).length === 0) {
    return null
  }
  return JSON.stringify(value, null, 2)
}

function contextOf(output: Record<string, unknown>): TraceContext | null {
  const context = asRecord(output.context)
  const excerpt = text(context.excerpt)
  if (!excerpt) return null
  return { excerpt, truncated: context.truncated === true }
}

export function traceEntry(step: SteelAgentRunStepDTO): TraceEntry {
  const output = asRecord(step.output)
  const base = {
    id: step.id,
    kind: step.kind,
    status: step.status,
    createdAt: step.createdAt,
    input: null as string | null,
    context: null as TraceContext | null,
    round: null as number | null,
    tokens: null as number | null,
    toolCalls: [] as string[],
    rule: null as string | null,
    child: null as TraceEntry['child'],
  }
  const toolName = step.toolLabel ?? step.toolName ?? 'Ferramenta'

  if (step.kind === 'MODEL') {
    const calls = Array.isArray(output.toolCalls)
      ? output.toolCalls.filter((c): c is string => typeof c === 'string')
      : []
    const input = Number(output.inputTokens) || 0
    const out = Number(output.outputTokens) || 0
    return {
      ...base,
      title:
        typeof output.round === 'number'
          ? `Rodada ${output.round}: raciocínio do modelo`
          : 'Raciocínio do modelo',
      body: step.error ?? text(output.text),
      round: typeof output.round === 'number' ? output.round : null,
      tokens: input + out > 0 ? input + out : null,
      toolCalls: calls,
    }
  }

  if (step.kind === 'GUARDRAIL') {
    return {
      ...base,
      title: text(output.title) ?? 'Regra de guardrail acionada',
      body: text(output.detail) ?? step.error,
      rule: text(output.rule),
    }
  }

  if (step.kind === 'APPROVAL') {
    return {
      ...base,
      title: `Pediu aprovação: ${toolName}`,
      body: step.error ?? text(output.title) ?? text(output.summary),
      input: prettyInput(step.input),
    }
  }

  const childRunId = text(output.childRunId)
  const childAgentId = text(output.childAgentId)
  return {
    ...base,
    title: toolName,
    body: step.error ?? text(output.summary) ?? text(output.title),
    input: prettyInput(step.input),
    context: contextOf(output),
    child:
      childRunId && childAgentId
        ? {
            agentId: childAgentId,
            runId: childRunId,
            agentName: text(output.childAgentName),
          }
        : null,
  }
}

export function summarizeTrace(steps: SteelAgentRunStepDTO[]): TraceSummary {
  return {
    rounds: steps.filter((s) => s.kind === 'MODEL').length,
    tools: steps.filter((s) => s.kind === 'TOOL').length,
    guardrails: steps.filter((s) => s.kind === 'GUARDRAIL').length,
    approvals: steps.filter((s) => s.kind === 'APPROVAL').length,
  }
}
