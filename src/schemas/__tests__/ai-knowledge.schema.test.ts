import { describe, expect, it } from 'vitest'
import {
  AI_KNOWLEDGE_DEFAULT_LIMIT,
  AI_KNOWLEDGE_MAX_LIMIT,
  AiKnowledgeSearchQuerySchema,
  SteelSearchToolArgsSchema,
} from '../ai-knowledge.schema'

describe('AiKnowledgeSearchQuerySchema', () => {
  it('should parse the query, the source list and the limit', () => {
    expect(
      AiKnowledgeSearchQuerySchema.parse({
        q: '  como trocar a senha  ',
        sources: 'wiki-page, sd-kb-article,',
        limit: '5',
      }),
    ).toEqual({
      q: 'como trocar a senha',
      sources: ['wiki-page', 'sd-kb-article'],
      limit: 5,
    })
    expect(AiKnowledgeSearchQuerySchema.parse({ q: 'vpn' })).toEqual({
      q: 'vpn',
      sources: undefined,
      limit: AI_KNOWLEDGE_DEFAULT_LIMIT,
    })
    expect(
      AiKnowledgeSearchQuerySchema.parse({ q: 'vpn', sources: '  ' }).sources,
    ).toBeUndefined()
  })

  it('should reject short or long queries, unknown sources and bad limits', () => {
    for (const input of [
      { q: 'a' },
      { q: 'x'.repeat(501) },
      { q: 'vpn', sources: 'crm-lead' },
      { q: 'vpn', sources: ',' },
      { q: 'vpn', limit: AI_KNOWLEDGE_MAX_LIMIT + 1 },
      { q: 'vpn', limit: 0 },
    ]) {
      expect(AiKnowledgeSearchQuerySchema.safeParse(input).success).toBe(false)
    }
  })
})

describe('SteelSearchToolArgsSchema', () => {
  it('should accept the tool arguments and reject extra keys', () => {
    expect(
      SteelSearchToolArgsSchema.parse({
        query: 'política de férias',
        sources: ['wiki-page'],
      }),
    ).toEqual({
      query: 'política de férias',
      sources: ['wiki-page'],
      limit: AI_KNOWLEDGE_DEFAULT_LIMIT,
    })
    expect(
      SteelSearchToolArgsSchema.safeParse({ query: 'vpn', types: [] }).success,
    ).toBe(false)
    expect(
      SteelSearchToolArgsSchema.safeParse({ query: 'vpn', sources: [] })
        .success,
    ).toBe(false)
  })
})
