import {
  checkAnswer,
  evaluateCondition,
  interpolate,
  interpolateJson,
  readPath,
} from '@/src/lib/whatsapp/chatbot/text'
import type { ProcedureStep } from '@/src/schemas/ai-procedure.schema'
import type {
  ProcedureDefinition,
  ProcedureEvent,
  ProcedureExecutors,
  ProcedureOutcome,
  ProcedureState,
  SettleResult,
} from './types'

/**
 * Deterministic engine of a procedure (A5). It — not the model — decides
 * which step is next: steps run strictly in order, a required step is never
 * skipped (only a false condition skips it), and the model can only hand in
 * the value the current COLLECT step asks for. Pure apart from the injected
 * executors, so it is unit-testable without a database or a provider.
 */

export function initialState(
  definition: Pick<ProcedureDefinition, 'steps'>,
  variables: Record<string, string> = {},
): ProcedureState {
  return {
    variables: { ...variables },
    steps: Object.fromEntries(
      definition.steps.map((step) => [
        step.key,
        { status: 'PENDING' as const, attempts: 0 },
      ]),
    ),
  }
}

/** Tolerates a state saved by an older shape of the definition. */
function progressOf(state: ProcedureState, key: string) {
  return state.steps[key] ?? { status: 'PENDING' as const, attempts: 0 }
}

export function conditionHolds(
  step: ProcedureStep,
  variables: Record<string, string>,
): boolean {
  if (!step.condition) return true
  const { variable, operator, value } = step.condition
  return evaluateCondition(
    operator,
    variables[variable] ?? '',
    interpolate(value, variables),
  )
}

/** First step still pending, or null when the procedure is over. */
export function currentStep(
  definition: Pick<ProcedureDefinition, 'steps'>,
  state: ProcedureState,
): ProcedureStep | null {
  return (
    definition.steps.find(
      (step) => progressOf(state, step.key).status === 'PENDING',
    ) ?? null
  )
}

function mark(
  state: ProcedureState,
  key: string,
  status: 'DONE' | 'SKIPPED' | 'FAILED',
  attempts?: number,
) {
  const previous = progressOf(state, key)
  state.steps[key] = { status, attempts: attempts ?? previous.attempts }
}

function saveAll(
  state: ProcedureState,
  saves: { variable: string; path: string }[],
  json: unknown,
) {
  for (const save of saves) {
    state.variables[save.variable] = readPath(json, save.path) ?? ''
  }
}

/** What failure of a step means: required ⇒ human takes over, else skip. */
function failStep(
  step: ProcedureStep,
  state: ProcedureState,
  events: ProcedureEvent[],
  reason: string,
  input?: unknown,
): ProcedureOutcome | null {
  events.push({
    stepKey: step.key,
    kind: step.kind,
    title: step.title,
    status: 'FAILED',
    error: reason,
    ...(input !== undefined && { input }),
  })
  if (step.required) {
    mark(state, step.key, 'FAILED')
    return { kind: 'failed', stepKey: step.key, reason }
  }
  mark(state, step.key, 'SKIPPED')
  return null
}

/**
 * Runs everything that needs no model (conditions, HTTP, tools, fixed
 * messages) until a step needs the customer (COLLECT), the model's own words
 * (MESSAGE with an instruction), the procedure ends or a required step fails.
 */
export async function settle(
  definition: ProcedureDefinition,
  previous: ProcedureState,
  executors: ProcedureExecutors,
): Promise<SettleResult> {
  const state: ProcedureState = {
    variables: { ...previous.variables },
    steps: { ...previous.steps },
  }
  const events: ProcedureEvent[] = []
  const messages: string[] = []

  for (;;) {
    const step = currentStep(definition, state)
    if (!step) return { state, events, messages, outcome: { kind: 'completed' } }

    if (!conditionHolds(step, state.variables)) {
      mark(state, step.key, 'SKIPPED')
      events.push({
        stepKey: step.key,
        kind: step.kind,
        title: step.title,
        status: 'SKIPPED',
        output: { reason: 'condition_false' },
      })
      continue
    }

    switch (step.kind) {
      case 'COLLECT':
        return {
          state,
          events,
          messages,
          outcome: { kind: 'waiting', stepKey: step.key },
        }
      case 'MESSAGE':
        if (!step.text) {
          return {
            state,
            events,
            messages,
            outcome: { kind: 'waiting', stepKey: step.key },
          }
        }
        {
          const text = interpolate(step.text, state.variables)
          messages.push(text)
          mark(state, step.key, 'DONE')
          events.push({
            stepKey: step.key,
            kind: step.kind,
            title: step.title,
            status: 'OK',
            output: { message: text },
          })
        }
        break
      case 'HANDOFF': {
        const text = step.text
          ? interpolate(step.text, state.variables)
          : null
        if (text) messages.push(text)
        mark(state, step.key, 'DONE')
        events.push({
          stepKey: step.key,
          kind: step.kind,
          title: step.title,
          status: 'OK',
          output: { handoff: true },
        })
        return {
          state,
          events,
          messages,
          outcome: { kind: 'handoff', stepKey: step.key },
        }
      }
      case 'HTTP': {
        const request = {
          url: interpolate(step.url, state.variables),
          method: step.method,
          ...(step.method === 'POST' && step.body
            ? { body: interpolateJson(step.body, state.variables) }
            : {}),
        }
        const result = await executors.http(request)
        if (!result.ok) {
          const failed = failStep(step, state, events, result.reason, request)
          if (failed) return { state, events, messages, outcome: failed }
          break
        }
        saveAll(state, step.saves, result.json)
        mark(state, step.key, 'DONE')
        events.push({
          stepKey: step.key,
          kind: step.kind,
          title: step.title,
          status: 'OK',
          input: request,
          output: {
            saved: step.saves.map((save) => save.variable),
          },
        })
        break
      }
      case 'TOOL': {
        const args = Object.fromEntries(
          Object.entries(step.args).map(([name, value]) => [
            name,
            interpolate(value, state.variables),
          ]),
        )
        const result = await executors.tool(step.toolName, args)
        if (!result.ok) {
          const failed = failStep(step, state, events, result.reason, args)
          if (failed) return { state, events, messages, outcome: failed }
          break
        }
        saveAll(state, step.saves, result.json)
        mark(state, step.key, 'DONE')
        events.push({
          stepKey: step.key,
          kind: step.kind,
          title: step.title,
          status: 'OK',
          input: { toolName: step.toolName, args },
          output: {
            saved: step.saves.map((save) => save.variable),
          },
        })
        break
      }
    }
  }
}

export type SubmitResult =
  | { ok: true; state: ProcedureState; events: ProcedureEvent[] }
  | {
      ok: false
      reason: 'out_of_order' | 'invalid' | 'no_step'
      state: ProcedureState
      events: ProcedureEvent[]
      /** The step that is actually current. */
      expected?: string
      attemptsLeft?: number
      /** The attempts ran out: the procedure failed. */
      failed?: Extract<ProcedureOutcome, { kind: 'failed' }>
    }

/**
 * The model hands in the value for a variable. Accepted only when the
 * current step is the COLLECT step of exactly that variable and the value
 * passes its validation; otherwise nothing changes (out of order) or the
 * attempt is counted. Running out of attempts fails a required step.
 */
export function submitValue(
  definition: ProcedureDefinition,
  previous: ProcedureState,
  variable: string,
  value: string,
): SubmitResult {
  const state: ProcedureState = {
    variables: { ...previous.variables },
    steps: { ...previous.steps },
  }
  const step = currentStep(definition, state)
  if (!step) {
    return { ok: false, reason: 'no_step', state, events: [] }
  }
  if (step.kind !== 'COLLECT' || step.variable !== variable) {
    return {
      ok: false,
      reason: 'out_of_order',
      state,
      expected: step.key,
      events: [
        {
          stepKey: step.key,
          kind: 'GUARD',
          title: 'Tentativa fora de ordem bloqueada',
          status: 'REJECTED',
          input: { variable },
          error: `O passo atual é "${step.title}"; não é possível pular ou reordenar.`,
        },
      ],
    }
  }
  const checked = checkAnswer(step.validation, value)
  if (checked.ok) {
    state.variables[variable] = checked.value
    mark(state, step.key, 'DONE')
    return {
      ok: true,
      state,
      events: [
        {
          stepKey: step.key,
          kind: 'COLLECT',
          title: step.title,
          status: 'OK',
          output: { variable, validation: step.validation },
        },
      ],
    }
  }
  const attempts = progressOf(state, step.key).attempts + 1
  const event: ProcedureEvent = {
    stepKey: step.key,
    kind: 'COLLECT',
    title: step.title,
    status: 'FAILED',
    error: 'Valor inválido',
    output: { variable, validation: step.validation, attempts },
  }
  if (attempts < definition.maxAttempts) {
    state.steps[step.key] = { status: 'PENDING', attempts }
    return {
      ok: false,
      reason: 'invalid',
      state,
      events: [event],
      attemptsLeft: definition.maxAttempts - attempts,
    }
  }
  if (step.required) {
    state.steps[step.key] = { status: 'FAILED', attempts }
    return {
      ok: false,
      reason: 'invalid',
      state,
      events: [event],
      attemptsLeft: 0,
      failed: {
        kind: 'failed',
        stepKey: step.key,
        reason: 'Valor inválido após todas as tentativas',
      },
    }
  }
  state.steps[step.key] = { status: 'SKIPPED', attempts }
  return {
    ok: false,
    reason: 'invalid',
    state,
    events: [event],
    attemptsLeft: 0,
  }
}

/** The model wrote a MESSAGE-with-instruction step: it is done. */
export function completeMessage(
  definition: ProcedureDefinition,
  previous: ProcedureState,
  text: string,
): { state: ProcedureState; events: ProcedureEvent[] } {
  const step = currentStep(definition, previous)
  if (!step || step.kind !== 'MESSAGE' || step.text) {
    return { state: previous, events: [] }
  }
  const state: ProcedureState = {
    variables: previous.variables,
    steps: { ...previous.steps },
  }
  mark(state, step.key, 'DONE')
  return {
    state,
    events: [
      {
        stepKey: step.key,
        kind: 'MESSAGE',
        title: step.title,
        status: 'OK',
        output: { message: text.slice(0, 1000) },
      },
    ],
  }
}

export interface PlanItem {
  key: string
  title: string
  kind: ProcedureStep['kind']
  required: boolean
  applies: boolean
}

/** Editor preview: which steps would run for the given known variables. */
export function planFor(
  definition: Pick<ProcedureDefinition, 'steps'>,
  variables: Record<string, string>,
): PlanItem[] {
  return definition.steps.map((step) => ({
    key: step.key,
    title: step.title,
    kind: step.kind,
    required: step.required,
    applies: conditionHolds(step, variables),
  }))
}
