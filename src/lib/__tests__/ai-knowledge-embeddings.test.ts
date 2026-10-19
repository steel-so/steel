import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEmbedding } from '@/src/__tests__/factories/ai-knowledge.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

vi.mock('@/src/lib/ai/index', () => ({ getOpenAiClient: vi.fn(() => null) }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { getOpenAiClient } from '@/src/lib/ai/index'
import { readCitations } from '@/src/lib/ai/knowledge/citations'
import {
  EMBEDDING_BATCH_SIZE,
  type EmbeddingClient,
  embedTexts,
  isEmbeddingProviderConfigured,
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  KNOWLEDGE_EMBEDDING_MODEL,
  toVectorLiteral,
} from '@/src/lib/ai/knowledge/embeddings'

function fakeClient(
  impl?: (input: string[]) => {
    data: { index: number; embedding: number[] }[]
    usage?: { prompt_tokens: number }
  },
) {
  const create = vi.fn(async (body: { input: string[] }) =>
    impl
      ? impl(body.input)
      : {
          // Out of order on purpose: the client sorts by `index`.
          data: body.input
            .map((_, index) => ({ index, embedding: fakeEmbedding(index) }))
            .reverse(),
          usage: { prompt_tokens: body.input.length * 3 },
        },
  )
  return {
    client: { embeddings: { create } } as unknown as EmbeddingClient,
    create,
  }
}

beforeEach(() => {
  vi.mocked(getOpenAiClient).mockReturnValue(null)
})

describe('embedTexts', () => {
  it('should short-circuit an empty list and fail without a client', async () => {
    expect(expectOk(await embedTexts([], null))).toEqual({
      vectors: [],
      inputTokens: 0,
    })
    expectErr(await embedTexts(['x'], null), 'AI_KNOWLEDGE_EMBEDDING_FAILED')
    // Default client comes from the platform key.
    expectErr(await embedTexts(['x']), 'AI_KNOWLEDGE_EMBEDDING_FAILED')
  })

  it('should batch, keep the order and sum the tokens', async () => {
    const { client, create } = fakeClient()
    const texts = Array.from({ length: EMBEDDING_BATCH_SIZE + 2 }, (_, i) =>
      i === 0 ? '' : `t${i}`,
    )
    const result = expectOk(await embedTexts(texts, client))
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0][0]).toMatchObject({
      model: KNOWLEDGE_EMBEDDING_MODEL.model,
      dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
    })
    // An empty input is sent as a space (the API rejects empty strings).
    expect(create.mock.calls[0][0].input[0]).toBe(' ')
    expect(result.vectors).toHaveLength(texts.length)
    expect(result.vectors[1]).toEqual(fakeEmbedding(1))
    expect(result.inputTokens).toBe(texts.length * 3)
  })

  it('should cut very long inputs', async () => {
    const { client, create } = fakeClient()
    await embedTexts(['y'.repeat(20_000)], client)
    expect(create.mock.calls[0][0].input[0]).toHaveLength(8_000)
  })

  it('should reject a response of the wrong shape or size', async () => {
    const short = fakeClient(() => ({ data: [] })).client
    expectErr(await embedTexts(['a'], short), 'AI_KNOWLEDGE_EMBEDDING_FAILED')
    const wrongDims = fakeClient(() => ({
      data: [{ index: 0, embedding: [1, 2, 3] }],
    })).client
    expectErr(
      await embedTexts(['a'], wrongDims),
      'AI_KNOWLEDGE_EMBEDDING_FAILED',
    )
  })

  it('should count zero tokens when usage is missing', async () => {
    const { client } = fakeClient(() => ({
      data: [{ index: 0, embedding: fakeEmbedding(0) }],
    }))
    expect(expectOk(await embedTexts(['a'], client)).inputTokens).toBe(0)
  })

  it('should turn a provider error into a Result', async () => {
    const throwing = {
      embeddings: {
        create: vi.fn(async () => {
          throw new Error('429 rate limited')
        }),
      },
    } as unknown as EmbeddingClient
    const result = await embedTexts(['a'], throwing)
    expectErr(result, 'AI_KNOWLEDGE_EMBEDDING_FAILED')
    const rejectingString = {
      embeddings: {
        create: vi.fn(() => Promise.reject('boom')),
      },
    } as unknown as EmbeddingClient
    expectErr(
      await embedTexts(['a'], rejectingString),
      'AI_KNOWLEDGE_EMBEDDING_FAILED',
    )
  })
})

describe('embedding helpers', () => {
  it('should know whether the provider key is set', () => {
    expect(isEmbeddingProviderConfigured()).toBe(false)
    vi.mocked(getOpenAiClient).mockReturnValue({} as never)
    expect(isEmbeddingProviderConfigured()).toBe(true)
  })

  it('should format a vector literal', () => {
    expect(toVectorLiteral([0.5, -1, 0])).toBe('[0.5,-1,0]')
  })
})

describe('readCitations', () => {
  const ok = {
    sourceType: 'wiki-page',
    source: 'Página da Wiki',
    title: 'VPN',
    href: '/demo/wiki/1',
  }

  it('should read the results of a steel_search payload', () => {
    expect(readCitations({ results: [ok] })).toEqual([
      {
        sourceType: 'wiki-page',
        label: 'Página da Wiki',
        title: 'VPN',
        href: '/demo/wiki/1',
      },
    ])
  })

  it('should drop anything malformed or pointing outside the app', () => {
    expect(readCitations(null)).toEqual([])
    expect(readCitations('x')).toEqual([])
    expect(readCitations({ results: 'x' })).toEqual([])
    expect(
      readCitations({
        results: [
          null,
          'x',
          { ...ok, sourceType: 'crm-lead' },
          { ...ok, source: 1 },
          { ...ok, title: null },
          { ...ok, href: 3 },
          { ...ok, href: 'https://evil.example' },
          { ...ok, href: '//evil.example' },
        ],
      }),
    ).toEqual([])
  })

  it('should cap the number of citations', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...ok,
      href: `/demo/wiki/${i}`,
    }))
    expect(readCitations({ results: many })).toHaveLength(8)
  })
})
