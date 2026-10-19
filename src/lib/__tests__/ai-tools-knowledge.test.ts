import { describe, expect, it, vi } from 'vitest'
import { createFakeKnowledgeResultDTO } from '@/src/__tests__/factories/ai-knowledge.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { aiDisabled } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/ai-knowledge-search.service')

import { readCitations } from '@/src/lib/ai/knowledge/citations'
import { STEEL_AI_TOOLS } from '@/src/lib/ai/tools'
import { steelSearchTool } from '@/src/lib/ai/tools/knowledge'
import { validateToolRegistry } from '@/src/lib/ai/tools/registry'
import { AiKnowledgeSearchService } from '@/src/services/ai-knowledge-search.service'

const search = vi.mocked(AiKnowledgeSearchService)
const ctx = { workspaceId: 'ws1', actorId: 'u1', source: 'assistant' as const }

describe('steel_search tool', () => {
  it('should be a valid, platform-level read tool in the registry', () => {
    expect(STEEL_AI_TOOLS).toContain(steelSearchTool)
    expect(validateToolRegistry([steelSearchTool])).toEqual([])
    expect(steelSearchTool).toMatchObject({
      name: 'steel_search',
      kind: 'READ',
      module: null,
    })
    expect(steelSearchTool.description).toContain('[Título](href)')
  })

  it('should validate the arguments', () => {
    expect(
      expectOk(steelSearchTool.parse({ query: 'férias', limit: 3 })),
    ).toEqual({ query: 'férias', limit: 3 })
    expectErr(steelSearchTool.parse({ query: 'a' }), 'VALIDATION_ERROR')
    expectErr(
      steelSearchTool.parse(undefined as unknown as Record<string, unknown>),
      'VALIDATION_ERROR',
    )
  })

  it('should return numbered results the chat turns into citations', async () => {
    search.search.mockResolvedValue(
      ok({
        query: 'férias',
        mode: 'hybrid',
        results: [
          createFakeKnowledgeResultDTO({ title: 'Política de férias' }),
          createFakeKnowledgeResultDTO({
            sourceType: 'crm-note',
            sourceLabel: 'Nota do CRM',
            href: '/demo/crm',
          }),
        ],
        tookMs: 4,
      }),
    )
    const output = expectOk(
      await steelSearchTool.execute(ctx, {
        query: 'férias',
        sources: ['wiki-page'],
        limit: 5,
      }),
    )
    expect(search.search).toHaveBeenCalledWith('u1', 'ws1', {
      q: 'férias',
      sources: ['wiki-page'],
      limit: 5,
    })
    expect(output.summary).toBe('2 fonte(s) para "férias"')
    const data = output.data as { mode: string; results: unknown[] }
    expect(data.mode).toBe('hybrid')
    expect(data.results[0]).toEqual({
      ref: 1,
      sourceType: 'wiki-page',
      source: 'Página da Wiki',
      title: 'Política de férias',
      snippet: 'Abra o painel do roteador e altere a senha da rede.',
      href: '/demo/wiki/page1',
      updatedAt: '2026-10-01T12:00:00.000Z',
    })
    expect(readCitations(output.data)).toHaveLength(2)
  })

  it('should say when nothing was found and pass errors through', async () => {
    search.search.mockResolvedValue(
      ok({ query: 'x', mode: 'text', results: [], tookMs: 1 }),
    )
    expect(
      expectOk(await steelSearchTool.execute(ctx, { query: 'xy', limit: 8 }))
        .summary,
    ).toBe('Nada encontrado para "xy"')
    search.search.mockResolvedValue(err(aiDisabled()))
    expectErr(
      await steelSearchTool.execute(ctx, { query: 'xy', limit: 8 }),
      'AI_DISABLED',
    )
  })
})
