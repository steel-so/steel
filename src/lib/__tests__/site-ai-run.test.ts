import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { AiChatResponse, AiProvider } from '@/src/lib/ai/types'
import {
  describeIssues,
  parseModelJson,
  SITE_AI_MAX_ATTEMPTS,
  structuredCall,
} from '@/src/lib/site-ai/run'

function reply(
  text: string,
  stopReason: AiChatResponse['stopReason'] = 'end',
): AiChatResponse {
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant', content: text },
    usage: { inputTokens: 100, outputTokens: 50 },
    stopReason,
  }
}

function provider(...answers: Array<AiChatResponse | Error>) {
  const chat = vi.fn()
  for (const answer of answers) {
    if (answer instanceof Error) chat.mockRejectedValueOnce(answer)
    else chat.mockResolvedValueOnce(answer)
  }
  return {
    id: 'anthropic',
    chat,
    chatStream: vi.fn(),
  } as unknown as AiProvider & { chat: typeof chat }
}

const Schema = z.object({ title: z.string().min(1) })

function input(p: AiProvider, extra: Record<string, unknown> = {}) {
  return {
    provider: p,
    model: 'claude-x',
    system: 'sys',
    message: 'msg',
    schemaName: 'x',
    jsonSchema: { type: 'object' },
    schema: Schema,
    maxTokens: 100,
    onUsage: vi.fn(async () => undefined),
    ...extra,
  }
}

describe('parseModelJson', () => {
  it('reads plain JSON, fenced JSON, prose around it and trailing commas', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseModelJson('Claro! {"a":[1,2,],} Pronto.')).toEqual({
      a: [1, 2],
    })
  })

  it('returns null for arrays, scalars and garbage', () => {
    expect(parseModelJson('[1,2]')).toBeNull()
    expect(parseModelJson('42')).toBeNull()
    expect(parseModelJson('nada aqui')).toBeNull()
    expect(parseModelJson('{quebrado')).toBeNull()
  })
})

describe('describeIssues', () => {
  it('prefixes the path when there is one', () => {
    const issues = z
      .object({ a: z.string(), b: z.array(z.number()) })
      .refine(() => false, { message: 'geral' })
      .safeParse({ a: 1, b: ['x'] })
    expect(issues.success).toBe(false)
    if (issues.success) return
    expect(describeIssues(issues.error)).toEqual([
      expect.stringMatching(/^a: /),
      expect.stringMatching(/^b\.0: /),
    ])
    const root = z.string().safeParse(1)
    if (!root.success) {
      expect(describeIssues(root.error)[0]).toBe(root.error.issues[0].message)
    }
  })
})

describe('structuredCall', () => {
  it('returns the first valid answer and reports usage', async () => {
    const p = provider(reply('{"title":"Oi"}'))
    const args = input(p)
    const result = await structuredCall(args)
    expect(result).toEqual({ ok: true, value: { title: 'Oi' }, attempts: 1 })
    expect(args.onUsage).toHaveBeenCalledWith({
      inputTokens: 100,
      outputTokens: 50,
    })
    expect(p.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-x',
        system: 'sys',
        jsonSchema: { name: 'x', schema: { type: 'object' } },
        maxTokens: 100,
      }),
    )
  })

  it('sends the problems back and retries until it is valid', async () => {
    const p = provider(
      reply('não é json', 'max_tokens'),
      reply('{"title":""}'),
      reply('{"title":"Ok"}'),
    )
    const result = await structuredCall(input(p))
    expect(result).toEqual({ ok: true, value: { title: 'Ok' }, attempts: 3 })
    const third = p.chat.mock.calls[2][0]
    expect(third.messages).toHaveLength(5)
    expect(third.messages[2].content).toContain('cortada no meio')
    expect(third.messages[4].content).toContain('title:')
  })

  it('runs the domain validation and keeps the last partial answer', async () => {
    const p = provider(
      reply('{"title":"a"}'),
      reply('não'),
      reply('{"title":"b"}'),
    )
    const result = await structuredCall(
      input(p, { validate: () => ['Faltou algo'] }),
    )
    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      problems: ['Faltou algo'],
      attempts: SITE_AI_MAX_ATTEMPTS,
      partial: { title: 'b' },
    })
    const second = p.chat.mock.calls[1][0]
    expect(second.messages[2].content).toContain('Faltou algo')
  })

  it('fails without a partial when nothing parsed', async () => {
    const p = provider(reply('x'), reply('y'))
    const result = await structuredCall(input(p, { maxAttempts: 2 }))
    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      problems: ['A resposta não era um JSON válido'],
      attempts: 2,
    })
  })

  it('stops at a provider failure', async () => {
    const boom = new Error('timeout')
    const p = provider(reply('x'), boom)
    const args = input(p)
    const result = await structuredCall(args)
    expect(result).toMatchObject({
      ok: false,
      reason: 'provider',
      attempts: 2,
      cause: boom,
    })
    expect(args.onUsage).toHaveBeenCalledTimes(1)
  })
})
