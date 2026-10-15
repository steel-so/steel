import type { z } from 'zod'
import type { AiMessage, AiProvider, AiUsageTokens } from '@/src/lib/ai/types'

/**
 * One structured AI call with repair: the model's JSON is parsed leniently
 * (code fences, prose around it, trailing commas), checked by a Zod schema
 * and by the caller's own validation; when anything fails, the problems go
 * back to the model as a new turn and it tries again — up to
 * `SITE_AI_MAX_ATTEMPTS` calls. Usage of every call is reported, so a
 * failed generation is still charged for what it consumed.
 */

export const SITE_AI_MAX_ATTEMPTS = 3

/** Reads a JSON object out of a model reply; `null` when there is none. */
export function parseModelJson(text: string): unknown | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const attempts = [trimmed]
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start) attempts.push(trimmed.slice(start, end + 1))
  for (const candidate of [...attempts]) {
    attempts.push(candidate.replace(/,\s*([}\]])/g, '$1'))
  }
  for (const candidate of attempts) {
    try {
      const value = JSON.parse(candidate)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value
      }
    } catch {
      // try the next repair
    }
  }
  return null
}

/** Zod issues as short pt-BR lines for the model. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 12).map((issue) => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })
}

export interface StructuredCallInput<T> {
  provider: AiProvider
  model: string
  system: string
  message: string
  schemaName: string
  jsonSchema: Record<string, unknown>
  schema: z.ZodType<T>
  maxTokens: number
  /** Domain checks after the schema; problems in pt-BR (empty = valid). */
  validate?: (value: T) => string[]
  /** Called after every provider call with its token usage. */
  onUsage: (usage: AiUsageTokens) => Promise<void>
  maxAttempts?: number
}

export type StructuredCallResult<T> =
  | { ok: true; value: T; attempts: number }
  | {
      ok: false
      /** `provider`: the call itself failed; `invalid`: no usable answer. */
      reason: 'provider' | 'invalid'
      problems: string[]
      attempts: number
      cause?: unknown
      /** Last answer that passed the schema but not `validate` (callers
       * may still use what it has). */
      partial?: T
    }

function repairMessage(problems: string[]): string {
  return [
    'A resposta anterior não pôde ser usada por estes problemas:',
    ...problems.map((problem) => `- ${problem}`),
    'Corrija e devolva o JSON completo, no mesmo formato pedido, sem texto fora do JSON.',
  ].join('\n')
}

export async function structuredCall<T>(
  input: StructuredCallInput<T>,
): Promise<StructuredCallResult<T>> {
  const messages: AiMessage[] = [{ role: 'user', content: input.message }]
  const maxAttempts = input.maxAttempts ?? SITE_AI_MAX_ATTEMPTS
  let problems: string[] = []
  let partial: T | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Awaited<ReturnType<AiProvider['chat']>>
    try {
      response = await input.provider.chat({
        model: input.model,
        system: input.system,
        messages,
        jsonSchema: { name: input.schemaName, schema: input.jsonSchema },
        maxTokens: input.maxTokens,
      })
    } catch (cause) {
      return {
        ok: false,
        reason: 'provider',
        problems: ['O provedor de IA não respondeu'],
        attempts: attempt,
        cause,
      }
    }
    await input.onUsage(response.usage)

    const raw = parseModelJson(response.text)
    if (raw === null) {
      problems = [
        response.stopReason === 'max_tokens'
          ? 'A resposta foi cortada no meio: seja mais conciso'
          : 'A resposta não era um JSON válido',
      ]
    } else {
      const parsed = input.schema.safeParse(raw)
      if (!parsed.success) {
        problems = describeIssues(parsed.error)
      } else {
        problems = input.validate?.(parsed.data) ?? []
        if (problems.length === 0) {
          return { ok: true, value: parsed.data, attempts: attempt }
        }
        partial = parsed.data
      }
    }
    messages.push(response.message, {
      role: 'user',
      content: repairMessage(problems),
    })
  }
  return {
    ok: false,
    reason: 'invalid',
    problems,
    attempts: maxAttempts,
    ...(partial === undefined ? {} : { partial }),
  }
}
