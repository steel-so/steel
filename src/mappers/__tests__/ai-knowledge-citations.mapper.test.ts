import { describe, expect, it } from 'vitest'
import { createFakeAiMessage } from '@/src/__tests__/factories/steel-ai.factory'
import { toAiMessageDTOs } from '../ai-conversation.mapper'

const meta = (name: string) => ({ label: name, module: null })

const result = {
  status: 'done',
  summary: '1 fonte(s)',
  data: {
    mode: 'text',
    results: [
      {
        ref: 1,
        sourceType: 'wiki-page',
        source: 'Página da Wiki',
        title: 'Política de férias',
        snippet: '30 dias por ano',
        href: '/demo/wiki/p1',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
  },
}

function rows(name: string, payload: unknown) {
  return [
    createFakeAiMessage({ id: 'u1', role: 'USER', content: 'Férias?' }),
    createFakeAiMessage({
      id: 'a1',
      role: 'ASSISTANT',
      content: '30 dias.',
      toolCalls: [{ id: 'c1', name, arguments: { query: 'férias' } }],
    }),
    createFakeAiMessage({
      id: 't1',
      role: 'TOOL',
      toolCallId: 'c1',
      content: JSON.stringify(payload),
    }),
  ]
}

describe('steel_search citations in the transcript', () => {
  it('should restore the citations of a steel_search call', () => {
    const [, turn] = toAiMessageDTOs(rows('steel_search', result), [], meta)
    expect(turn.toolCalls[0]).toMatchObject({
      name: 'steel_search',
      status: 'done',
      citations: [
        {
          sourceType: 'wiki-page',
          label: 'Página da Wiki',
          title: 'Política de férias',
          href: '/demo/wiki/p1',
        },
      ],
    })
  })

  it('should ignore results of other tools, failures and empty searches', () => {
    const [, other] = toAiMessageDTOs(rows('ws_search', result), [], meta)
    expect(other.toolCalls[0].citations).toBeUndefined()

    const [, failed] = toAiMessageDTOs(
      rows('steel_search', { ...result, status: 'error' }),
      [],
      meta,
    )
    expect(failed.toolCalls[0].citations).toBeUndefined()

    const [, empty] = toAiMessageDTOs(
      rows('steel_search', { ...result, data: { results: [] } }),
      [],
      meta,
    )
    expect(empty.toolCalls[0].citations).toBeUndefined()
  })
})
