import type { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSite,
  createFakeSitePage,
} from '@/src/__tests__/factories/site.factory'
import { searchDocument } from '@/src/__tests__/factories/site-search.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { aiQuotaExceeded, databaseError, featureNotEnabled } from '@/src/errors'
import { heading, text } from '@/src/lib/canvas-site/presets/builder'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/site-page.repository')
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/services/feature-flag.service')

import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import { AiUsageService } from '@/src/services/ai-usage.service'
import { assertFeature } from '@/src/services/feature-flag.service'
import {
  briefMessage,
  optimizeSystem,
  pageBrief,
  SiteSearchAiService,
  SUMMARY_SYSTEM,
} from '../site-search-ai.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const pages = vi.mocked(SitePageRepository)
const ai = vi.mocked(AiUsageService)
const feature = vi.mocked(assertFeature)

const WS = 'ws1'
const SITE = 'site1'
const json = (value: unknown) => value as Prisma.JsonValue
const provider = { id: 'anthropic' as const, chat: vi.fn() }

function chat(payload: unknown) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return {
    text: body,
    toolCalls: [],
    message: { role: 'assistant' as const, content: body },
    usage: { inputTokens: 300, outputTokens: 120 },
    stopReason: 'end' as const,
  }
}

const site = createFakeSite({
  id: SITE,
  workspaceId: WS,
  name: 'Sorriso',
  settings: json({
    seo: { titleTemplate: '%s | Sorriso' },
    search: {
      business: {
        name: 'Clínica Sorriso',
        category: 'Odontologia',
        address: { city: 'São Paulo' },
      },
    },
  }),
})

const page = createFakeSitePage({
  id: 'p1',
  siteId: SITE,
  title: 'Implante',
  document: json(
    searchDocument(
      heading('h1', 'Implante dentário'),
      heading('h2', 'Quanto custa?'),
      text('<p>A partir de R$ 2.000.</p>'),
      heading('h2', 'Dói?'),
    ),
  ),
  seo: json({
    description: 'Descrição atual',
    search: {
      focusKeyword: 'implante',
      questions: [{ question: 'Tem garantia?', answer: '' }],
    },
  }),
})

beforeEach(() => {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  sites.findById.mockResolvedValue(ok(site))
  pages.findById.mockResolvedValue(ok(page))
  pages.listWithDocuments.mockResolvedValue(
    ok([page, createFakeSitePage({ id: 'p2', title: 'Sobre', seo: json({}) })]),
  )
  feature.mockResolvedValue(ok(true))
  ai.prepare.mockResolvedValue(
    ok({
      feature: 'CRM_ASSISTANT',
      provider: provider as never,
      model: {
        key: 'anthropic:claude',
        provider: 'anthropic',
        model: 'claude-x',
        label: 'Claude',
      } as never,
    }),
  )
  ai.record.mockResolvedValue(undefined)
  provider.chat.mockReset()
})

describe('prompts', () => {
  it('briefs the page with the business, keyword and questions', () => {
    const brief = pageBrief(site, page)
    expect(brief.title).toBe('Implante | Sorriso')
    expect(brief.business).toBe('Clínica Sorriso — Odontologia — São Paulo')
    expect(brief.keyword).toBe('implante')
    expect(brief.text).toContain('# Implante dentário')
    expect(brief.questions).toEqual([
      { question: 'Tem garantia?', answer: '' },
      { question: 'Quanto custa?', answer: 'A partir de R$ 2.000.' },
      { question: 'Dói?', answer: '' },
    ])
    const message = briefMessage(brief)
    expect(message).toContain('Palavra-chave principal: implante')
    expect(message).toContain('- Quanto custa? → A partir de R$ 2.000.')
    expect(message).toContain('- Dói?\n')
  })

  it('handles a bare page', () => {
    const bare = pageBrief(
      createFakeSite({ name: 'S', settings: json({}) }),
      createFakeSitePage({
        title: 'Vazia',
        document: json(searchDocument()),
        seo: json({}),
      }),
    )
    const message = briefMessage(bare)
    expect(message).toContain('Descrição atual: (vazia)')
    expect(message).toContain('(sem texto)')
    expect(message).not.toContain('Palavra-chave')
    expect(message).not.toContain('Perguntas da página')
  })

  it('asks only for the requested fields', () => {
    expect(SUMMARY_SYSTEM).toContain('"suggestions"')
    const all = optimizeSystem(['title', 'description', 'answers'])
    expect(all).toContain('"title"')
    expect(all).toContain('"description": meta descrição')
    expect(all).toContain('"answers": para cada pergunta')
    expect(optimizeSystem(['answers'])).not.toContain('"title": título')
  })
})

describe('SiteSearchAiService gate', () => {
  it('needs edit access, the plan feature and quota', async () => {
    membership.findByUserAndWorkspace.mockResolvedValueOnce(
      ok(createFakeMembership({ role: 'VIEWER' })),
    )
    expectErr(
      await SiteSearchAiService.summary('u1', WS, SITE, { pageId: 'p1' }),
      'FORBIDDEN',
    )

    feature.mockResolvedValueOnce(err(featureNotEnabled('crm.aiAssistant')))
    expectErr(
      await SiteSearchAiService.summary('u1', WS, SITE, { pageId: 'p1' }),
      'FEATURE_NOT_ENABLED',
    )

    ai.prepare.mockResolvedValueOnce(err(aiQuotaExceeded(10, 10)))
    expectErr(
      await SiteSearchAiService.optimize('u1', WS, SITE, {
        pageIds: ['p1'],
        fields: ['title'],
      }),
      'AI_QUOTA_EXCEEDED',
    )
    expect(provider.chat).not.toHaveBeenCalled()
  })
})

describe('SiteSearchAiService.summary', () => {
  it('returns the generative view of the page and records usage', async () => {
    provider.chat.mockResolvedValueOnce(
      chat({
        summary: 'A Clínica Sorriso faz implantes em São Paulo.',
        entities: Array.from({ length: 10 }, (_, i) => `E${i}`),
        questions: ['Quanto custa?'],
        suggestions: ['Informe o prazo'],
      }),
    )
    const result = expectOk(
      await SiteSearchAiService.summary('u1', WS, SITE, { pageId: 'p1' }),
    )
    expect(result.summary).toContain('implantes')
    expect(result.entities).toHaveLength(8)
    expect(ai.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: WS,
        userId: 'u1',
        scope: { module: 'CRM' },
      }),
    )
    expect(provider.chat.mock.calls[0][0].jsonSchema.name).toBe(
      'site_page_ai_summary',
    )
  })

  it('maps provider failures and bad output to SITE_SEARCH_AI_FAILED', async () => {
    provider.chat.mockRejectedValueOnce(new Error('timeout'))
    expectErr(
      await SiteSearchAiService.summary('u1', WS, SITE, { pageId: 'p1' }),
      'SITE_SEARCH_AI_FAILED',
    )
    provider.chat.mockRejectedValueOnce('boom')
    expectErr(
      await SiteSearchAiService.summary('u1', WS, SITE, { pageId: 'p1' }),
      'SITE_SEARCH_AI_FAILED',
    )
    provider.chat.mockResolvedValueOnce(chat('não é json'))
    const bad = expectErr(
      await SiteSearchAiService.summary('u1', WS, SITE, { pageId: 'p1' }),
      'SITE_SEARCH_AI_FAILED',
    )
    expect(bad.message).toContain('resumo aproveitável')
  })

  it('propagates a missing page', async () => {
    pages.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteSearchAiService.summary('u1', WS, SITE, { pageId: 'p1' }),
      'DATABASE_ERROR',
    )
  })
})

describe('SiteSearchAiService.optimize', () => {
  it('suggests titles, descriptions and answers for known questions', async () => {
    provider.chat
      .mockResolvedValueOnce(
        chat({
          title: `Implante dentário em São Paulo ${'x'.repeat(120)} fim`,
          description: 'Nova descrição com chamada.',
          answers: [
            {
              question: 'quanto custa?',
              answer: 'A partir de R$ 2.000, em até 12 vezes.',
            },
            { question: 'Pergunta inventada?', answer: 'Não deveria vir' },
            { question: 'Dói?', answer: '' },
          ],
        }),
      )
      .mockResolvedValueOnce(chat({ title: '', description: '', answers: [] }))
    const result = expectOk(
      await SiteSearchAiService.optimize('u1', WS, SITE, {
        pageIds: ['p1', 'p2'],
        fields: ['title', 'description', 'answers'],
      }),
    )
    const [first, second] = result.items
    expect(first.title?.current).toBe('Implante')
    expect(first.title?.suggested.length).toBeLessThanOrEqual(120)
    expect(first.description).toEqual({
      current: 'Descrição atual',
      suggested: 'Nova descrição com chamada.',
    })
    expect(first.answers).toEqual([
      {
        question: 'Quanto custa?',
        current: 'A partir de R$ 2.000.',
        suggested: 'A partir de R$ 2.000, em até 12 vezes.',
      },
    ])
    expect(second).toEqual({ pageId: 'p2', pageTitle: 'Sobre' })
    expect(result.failed).toEqual([])
  })

  it('reports pages the provider failed on, and fails when all did', async () => {
    provider.chat
      .mockResolvedValueOnce(
        chat({ title: 'Ok', description: 'D', answers: [] }),
      )
      .mockResolvedValueOnce(chat('{'))
    const partial = expectOk(
      await SiteSearchAiService.optimize('u1', WS, SITE, {
        pageIds: ['p1', 'p2'],
        fields: ['description'],
      }),
    )
    expect(partial.items).toEqual([
      {
        pageId: 'p1',
        pageTitle: 'Implante',
        description: { current: 'Descrição atual', suggested: 'D' },
      },
    ])
    expect(partial.failed).toEqual([{ pageId: 'p2', pageTitle: 'Sobre' }])

    provider.chat.mockRejectedValueOnce(new Error('down'))
    expectErr(
      await SiteSearchAiService.optimize('u1', WS, SITE, {
        pageIds: ['p1'],
        fields: ['title'],
      }),
      'SITE_SEARCH_AI_FAILED',
    )
  })

  it('refuses unknown pages and propagates errors', async () => {
    expectErr(
      await SiteSearchAiService.optimize('u1', WS, SITE, {
        pageIds: ['nope'],
        fields: ['title'],
      }),
      'SITE_PAGE_NOT_FOUND',
    )
    pages.listWithDocuments.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteSearchAiService.optimize('u1', WS, SITE, {
        pageIds: ['p1'],
        fields: ['title'],
      }),
      'DATABASE_ERROR',
    )
  })
})
