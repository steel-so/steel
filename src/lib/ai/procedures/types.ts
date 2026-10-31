import type { ProcedureStep } from '@/src/schemas/ai-procedure.schema'

/** What the engine needs of a procedure version. */
export interface ProcedureDefinition {
  id: string
  name: string
  whenToUse: string
  steps: ProcedureStep[]
  maxAttempts: number
  handoffMessage: string | null
}

export type StepProgress = 'PENDING' | 'DONE' | 'SKIPPED' | 'FAILED'

/** Per-conversation (or per-agent-run) state, persisted as JSON. */
export interface ProcedureState {
  variables: Record<string, string>
  steps: Record<string, { status: StepProgress; attempts: number }>
}

export type ProcedureEventStatus = 'OK' | 'FAILED' | 'SKIPPED' | 'REJECTED'

/** One thing the engine did; becomes a run step in the trace. */
export interface ProcedureEvent {
  stepKey: string
  kind: ProcedureStep['kind'] | 'GUARD'
  title: string
  status: ProcedureEventStatus
  input?: unknown
  output?: unknown
  error?: string
}

export type ProcedureOutcome =
  | { kind: 'waiting'; stepKey: string }
  | { kind: 'completed' }
  | { kind: 'failed'; stepKey: string; reason: string }
  | { kind: 'handoff'; stepKey: string }

export interface SettleResult {
  state: ProcedureState
  events: ProcedureEvent[]
  /** Fixed messages the customer must receive, in order. */
  messages: string[]
  outcome: ProcedureOutcome
}

export type HttpResult =
  | { ok: true; json: unknown }
  | { ok: false; reason: string }

export interface ProcedureExecutors {
  http(request: {
    url: string
    method: 'GET' | 'POST'
    body?: unknown
  }): Promise<HttpResult>
  tool(name: string, args: Record<string, string>): Promise<HttpResult>
}
