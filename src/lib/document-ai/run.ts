import type {
  AiChatResponse,
  AiContentPart,
  AiMessage,
  AiProvider,
  AiUsageTokens,
} from '@/src/lib/ai/types'
import type { DocumentOutline } from '@/src/lib/canvas-document/outline'
import { describeIssues, parseModelJson } from '@/src/lib/site-ai/run'
import { DOCUMENT_AI_MAX_ATTEMPTS } from './constants'
import {
  DOCUMENT_OUTLINE_JSON_SCHEMA,
  DocumentOutlineAnswerSchema,
} from './outline-wire'

/**
 * The outline call of the AI import: streamed (a long document takes
 * minutes, and the streamed size moves the progress bar), parsed leniently,
 * validated by the outline contract and, when the answer is unusable, sent
 * back once with the problems. Usage of every call is reported, so a failed
 * import is still charged for what it consumed.
 */

export interface OutlineCallInput {
  provider: AiProvider
  model: string
  system: string
  content: string | AiContentPart[]
  maxTokens: number
  onUsage: (usage: AiUsageTokens) => Promise<void>
  /** Characters of the answer received so far (throttle on the caller). */
  onProgress?: (receivedChars: number) => void
  maxAttempts?: number
}

export type OutlineCallResult =
  | { ok: true; outline: DocumentOutline; attempts: number }
  | {
      ok: false
      /** `provider`: the call failed; `refusal`/`invalid`: no usable answer. */
      reason: 'provider' | 'refusal' | 'invalid'
      problems: string[]
      attempts: number
      cause?: unknown
    }

async function streamOnce(
  input: OutlineCallInput,
  messages: AiMessage[],
): Promise<AiChatResponse> {
  let received = 0
  let response: AiChatResponse | null = null
  const stream = input.provider.chatStream({
    model: input.model,
    system: input.system,
    messages,
    jsonSchema: {
      name: 'document_outline',
      schema: DOCUMENT_OUTLINE_JSON_SCHEMA,
    },
    maxTokens: input.maxTokens,
  })
  for await (const chunk of stream) {
    if (chunk.type === 'text') {
      received += chunk.delta.length
      input.onProgress?.(received)
    } else {
      response = chunk.response
    }
  }
  if (!response) throw new Error('AI stream ended without a response')
  return response
}

function repairMessage(problems: string[]): string {
  return [
    'The previous answer could not be used because of these problems:',
    ...problems.map((problem) => `- ${problem}`),
    'Fix them and return the complete JSON again, in the same format, with nothing outside the JSON.',
  ].join('\n')
}

export async function outlineCall(
  input: OutlineCallInput,
): Promise<OutlineCallResult> {
  const messages: AiMessage[] = [{ role: 'user', content: input.content }]
  const maxAttempts = input.maxAttempts ?? DOCUMENT_AI_MAX_ATTEMPTS
  let problems: string[] = []
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: AiChatResponse
    try {
      response = await streamOnce(input, messages)
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
    if (response.stopReason === 'refusal') {
      return {
        ok: false,
        reason: 'refusal',
        problems: ['O modelo recusou o conteúdo'],
        attempts: attempt,
      }
    }

    const raw = parseModelJson(response.text)
    if (raw === null) {
      problems = [
        response.stopReason === 'max_tokens'
          ? 'The answer was cut off: merge short paragraphs and keep text blocks compact'
          : 'The answer was not valid JSON',
      ]
    } else {
      const parsed = DocumentOutlineAnswerSchema.safeParse(raw)
      if (parsed.success) {
        return { ok: true, outline: parsed.data, attempts: attempt }
      }
      problems = describeIssues(parsed.error)
    }
    messages.push(response.message, {
      role: 'user',
      content: repairMessage(problems),
    })
  }
  return { ok: false, reason: 'invalid', problems, attempts: maxAttempts }
}
