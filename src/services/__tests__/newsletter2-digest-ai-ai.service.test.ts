import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeNewsletter,
  createFakeNewsletterIssue,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  aiQuotaExceeded,
  databaseError,
  featureNotEnabled,
  forbidden,
} from '@/src/errors'
import { buildDigestDocument } from '@/src/lib/crm-newsletter/digest-document'
import { err, ok } from '@/src/lib/result'
import { CrmNewsletterAiDraftSchema } from '@/src/schemas/crm-newsletter-ai.schema'

vi.mock('@/src/services/crm-newsletter-issue.service', () => ({
  loadNewsletterScope: vi.fn(),
  loadIssue: vi.fn(),
}))
vi.mock('@/src/services/authz', () => ({ assertModuleMember: vi.fn() }))
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/services/feature-flag.service')
vi.mock('@/src/repositories/crm-newsletter-ai.repository')
vi.mock('@/src/lib/sites/public-url', () => ({
  publicSiteUrl: (slug: string) => `https://${slug}.sites.test`,
}))

import { CrmNewsletterAiRepository } from '@/src/repositories/crm-newsletter-ai.repository'
import { AiUsageService } from '@/src/services/ai-usage.service'
import { assertModuleMember } from '@/src/services/authz'
import { assertFeature } from '@/src/services/feature-flag.service'
import {
  buildDraftMessage,
  buildDraftSystem,
  buildSubjectsSystem,
  CrmNewsletterAiService as Service,
} from '../crm-newsletter-ai.service'
import { loadIssue, loadNewsletterScope } from '../crm-newsletter-issue.service'

const repo = vi.mocked(CrmNewsletterAiRepository)
const ai = vi.mocked(AiUsageService)
const feature = vi.mocked(assertFeature)
const scope = vi.mocked(loadNewsletterScope)
const issue = vi.mocked(loadIssue)
const authz = vi.mocked(assertModuleMember)

const NOW = new Date('2026-10-28T13:00:00.000Z')
const A = ['u1', 'ws1', 'nl1', 'is1'] as const
const provider = { id: 'anthropic' as const, chat: vi.fn() }

function chat(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant' as const, content: text },
    usage: { inputTokens: 100, outputTokens: 50 },
    stopReason: 'end' as const,
  }
}

const SECTION = {
  background: 'none',
  columns: [
    {
      blocks: [
        {
          type: 'heading',
          text: 'Novidades de novembro',
          level: 'h1',
          items: [],
          url: '',
          author: '',
          role: '',
          code: '',
        },
        {
          type: 'text',
          text: 'Olá {{primeiro_nome}}, veja o que mudou.',
          level: 'h2',
          items: [],
          url: '',
          author: '',
          role: '',
          code: '',
        },
      ],
    },
  ],
}

const POST = {
  id: 'p1',
  title: 'Como escolher um plano',
  slug: 'planos',
  excerpt: 'Guia rápido',
  autoExcerpt: 'Auto',
  plainText: 'Texto completo do post',
  coverImageUrl: 'https://cdn.acme/p1.png',
  publishedAt: NOW,
  site: { name: 'Site', slug: 'acme', publishedAt: NOW },
}

const dto = (over: Record<string, unknown> = {}) =>
  CrmNewsletterAiDraftSchema.parse({
    brief: 'Novidades de novembro e o webinar do dia 20',
    ...over,
  })

beforeEach(() => {
  vi.clearAllMocks()
  scope.mockResolvedValue(
    ok({ membership: {} as never, newsletter: createFakeNewsletter() }),
  )
  issue.mockResolvedValue(
    ok(
      createFakeNewsletterIssue({
        builderDocument: buildDigestDocument({
          title: 'Resumo da semana',
          intro: 'Olá {{primeiro_nome}}',
          posts: [],
          preheader: '',
        }) as never,
      }),
    ),
  )
  authz.mockResolvedValue(ok({} as never))
  feature.mockResolvedValue(ok(true))
  ai.prepare.mockResolvedValue(
    ok({
      feature: 'CRM_ASSISTANT',
      provider: provider as never,
      model: {
        key: 'k',
        provider: 'anthropic',
        model: 'm',
        label: 'L',
      } as never,
    }),
  )
  ai.record.mockResolvedValue(undefined)
  repo.findPosts.mockResolvedValue(ok([POST]))
  repo.findKbArticles.mockResolvedValue(
    ok([
      { id: 'kb1', title: 'Como resetar a senha', plainText: 'Passo a passo' },
    ]),
  )
  repo.findProducts.mockResolvedValue(
    ok([
      {
        id: 'pr1',
        name: 'Plano Pro',
        description: 'Tudo incluso',
        unitPrice: { toString: () => '199.9' },
        currency: 'BRL',
      },
    ]),
  )
  provider.chat.mockResolvedValue(
    chat({
      reply: 'Pronto!',
      subject: 'Novidades de novembro',
      preheader: 'O que mudou e o webinar',
      sections: [SECTION, { ...SECTION, columns: [{ blocks: [] }] }],
    }),
  )
})

describe('prompts', () => {
  it('only carries the chosen sources, clipped', () => {
    const message = buildDraftMessage({
      brief: 'Pedido',
      posts: [
        {
          ...POST,
          excerpt: null,
          autoExcerpt: '',
          plainText: 'x'.repeat(2000),
        },
      ],
      articles: [{ id: 'kb1', title: 'Artigo', plainText: 'Corpo' }],
      products: [
        {
          id: 'pr1',
          name: 'Grátis',
          description: null,
          unitPrice: { toString: () => '0' },
          currency: '',
        },
      ],
    })
    expect(message).toContain('Pedido')
    expect(message).toContain('Posts do blog escolhidos')
    expect(message).toContain('…')
    expect(message).toContain('- Artigo: Corpo')
    expect(message).toContain('- Grátis: ')
    expect(
      buildDraftMessage({ brief: 'Só', posts: [], articles: [], products: [] }),
    ).not.toContain('escolhid')
    expect(
      buildDraftSystem({ newsletterName: 'Acme', tone: 'formal' }),
    ).toContain('Tom formal')
    expect(buildSubjectsSystem('Acme')).toContain('exatamente 5')
  })
})

describe('sources()', () => {
  it('lists titles; KB only with ServiceDesk access', async () => {
    repo.listRecentPosts.mockResolvedValue(
      ok([
        { id: 'p1', title: 'Post', publishedAt: NOW, site: { name: 'Site' } },
      ]),
    )
    repo.listProducts.mockResolvedValue(ok([{ id: 'pr1', name: 'Plano' }]))
    repo.listKbArticles.mockResolvedValue(ok([{ id: 'kb1', title: 'Artigo' }]))
    const result = expectOk(await Service.sources('u1', 'ws1', 'nl1', NOW))
    expect(result).toEqual({
      posts: [
        {
          id: 'p1',
          title: 'Post',
          siteName: 'Site',
          publishedAt: NOW.toISOString(),
        },
      ],
      kbArticles: [{ id: 'kb1', title: 'Artigo' }],
      products: [{ id: 'pr1', name: 'Plano' }],
    })
    authz.mockResolvedValueOnce(err(forbidden()))
    expect(
      expectOk(await Service.sources('u1', 'ws1', 'nl1', NOW)).kbArticles,
    ).toBeNull()
  })

  it('denials and database errors', async () => {
    repo.listRecentPosts.mockResolvedValue(ok([]))
    repo.listProducts.mockResolvedValue(ok([]))
    repo.listKbArticles.mockResolvedValue(ok([]))
    scope.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.sources('u1', 'ws1', 'nl1', NOW), 'FORBIDDEN')
    repo.listRecentPosts.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.sources('u1', 'ws1', 'nl1', NOW), 'DATABASE_ERROR')
    repo.listProducts.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.sources('u1', 'ws1', 'nl1', NOW), 'DATABASE_ERROR')
    repo.listKbArticles.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.sources('u1', 'ws1', 'nl1', NOW), 'DATABASE_ERROR')
  })
})

describe('draft()', () => {
  it('returns valid sections plus the chosen posts with their real links', async () => {
    const result = expectOk(
      await Service.draft(
        ...A,
        dto({ postIds: ['p1'], kbArticleIds: ['kb1'], productIds: ['pr1'] }),
        NOW,
      ),
    )
    expect(result.subject).toBe('Novidades de novembro')
    expect(result.preheader).toBe('O que mudou e o webinar')
    expect(result.reply).toBe('Pronto!')
    // One AI section (the empty one is dropped) + the posts list.
    expect(result.sections).toHaveLength(2)
    const posts = JSON.stringify(result.sections[1])
    expect(posts).toContain('https://acme.sites.test/blog/planos')
    expect(posts).toContain('Leia no blog')
    const call = provider.chat.mock.calls[0][0]
    expect(call.messages[0].content).toContain('Como resetar a senha')
    expect(call.messages[0].content).toContain('Plano Pro')
    expect(ai.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: 'ws1', scope: { module: 'CRM' } }),
    )
    expect(repo.findPosts).toHaveBeenCalledWith('ws1', ['p1'], NOW)
  })

  it('ignores KB ids without ServiceDesk access and unpublished-site posts', async () => {
    authz.mockResolvedValueOnce(err(forbidden()))
    repo.findPosts.mockResolvedValueOnce(
      ok([{ ...POST, site: { ...POST.site, publishedAt: null } }]),
    )
    const result = expectOk(
      await Service.draft(
        ...A,
        dto({ kbArticleIds: ['kb1'], postIds: ['p1'] }),
        NOW,
      ),
    )
    expect(repo.findKbArticles).toHaveBeenCalledWith('ws1', [])
    expect(result.sections).toHaveLength(1)
  })

  it('falls back to a default reply', async () => {
    provider.chat.mockResolvedValueOnce(
      chat({
        reply: ' ',
        subject: 'Assunto',
        preheader: '',
        sections: [SECTION],
      }),
    )
    expect(expectOk(await Service.draft(...A, dto(), NOW)).reply).toContain(
      'Revise a edição',
    )
  })

  it('fails on a provider error or unusable output', async () => {
    provider.chat.mockRejectedValueOnce(new Error('down'))
    expectErr(await Service.draft(...A, dto(), NOW), 'CRM_NEWSLETTER_AI_FAILED')
    provider.chat.mockResolvedValueOnce(chat('não é json'))
    expectErr(await Service.draft(...A, dto(), NOW), 'CRM_NEWSLETTER_AI_FAILED')
    provider.chat.mockResolvedValueOnce(
      chat({ reply: '', subject: '', preheader: '', sections: [SECTION] }),
    )
    expectErr(await Service.draft(...A, dto(), NOW), 'CRM_NEWSLETTER_AI_FAILED')
    provider.chat.mockResolvedValueOnce(
      chat({
        reply: '',
        subject: 'S',
        preheader: '',
        sections: [{ ...SECTION, columns: [{ blocks: [] }] }],
      }),
    )
    expectErr(await Service.draft(...A, dto(), NOW), 'CRM_NEWSLETTER_AI_FAILED')
  })

  it('gates: permission, locked issue, plan feature, quota', async () => {
    scope.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.draft(...A, dto(), NOW), 'FORBIDDEN')
    issue.mockResolvedValueOnce(
      ok(createFakeNewsletterIssue({ status: 'SENT' })),
    )
    expectErr(
      await Service.draft(...A, dto(), NOW),
      'CRM_NEWSLETTER_ISSUE_LOCKED',
    )
    issue.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.draft(...A, dto(), NOW), 'DATABASE_ERROR')
    feature.mockResolvedValueOnce(err(featureNotEnabled()))
    expectErr(await Service.draft(...A, dto(), NOW), 'FEATURE_NOT_ENABLED')
    ai.prepare.mockResolvedValueOnce(err(aiQuotaExceeded(10, 10)))
    expectErr(await Service.draft(...A, dto(), NOW), 'AI_QUOTA_EXCEEDED')
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('propagates database errors of the sources', async () => {
    repo.findPosts.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.draft(...A, dto(), NOW), 'DATABASE_ERROR')
    repo.findKbArticles.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.draft(...A, dto(), NOW), 'DATABASE_ERROR')
    repo.findProducts.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.draft(...A, dto(), NOW), 'DATABASE_ERROR')
  })
})

describe('subjects()', () => {
  it('sends the issue text and returns unique, trimmed suggestions', async () => {
    provider.chat.mockResolvedValueOnce(
      chat({
        suggestions: [
          {
            subject: '"Novidades de novembro"',
            preheader: 'Veja\no que mudou',
          },
          { subject: 'novidades de novembro', preheader: 'repetido' },
          { subject: '', preheader: 'vazio' },
          { subject: 'Você viu?', preheader: '' },
          { subject: 'Três', preheader: '' },
          { subject: 'Quatro', preheader: '' },
          { subject: 'Cinco', preheader: '' },
          { subject: 'Seis', preheader: '' },
        ],
      }),
    )
    const result = expectOk(await Service.subjects(...A, { brief: 'curto' }))
    expect(result.suggestions).toHaveLength(5)
    expect(result.suggestions[0]).toEqual({
      subject: 'Novidades de novembro',
      preheader: 'Veja o que mudou',
    })
    const message = provider.chat.mock.calls[0][0].messages[0].content
    expect(message).toContain('Resumo da semana')
    expect(message).toContain('{{primeiro_nome}}')
    expect(message).toContain('Pedido do usuário: curto')
  })

  it('works on an empty issue', async () => {
    issue.mockResolvedValueOnce(
      ok(createFakeNewsletterIssue({ builderDocument: {} })),
    )
    provider.chat.mockResolvedValueOnce(
      chat({ suggestions: [{ subject: 'A', preheader: 'B' }] }),
    )
    expectOk(await Service.subjects(...A, {}))
    expect(provider.chat.mock.calls[0][0].messages[0].content).toContain(
      'ainda está vazia',
    )
  })

  it('fails on provider errors and empty output', async () => {
    provider.chat.mockRejectedValueOnce('down')
    expectErr(await Service.subjects(...A, {}), 'CRM_NEWSLETTER_AI_FAILED')
    provider.chat.mockResolvedValueOnce(
      chat({ suggestions: [{ subject: ' ', preheader: '' }] }),
    )
    expectErr(await Service.subjects(...A, {}), 'CRM_NEWSLETTER_AI_FAILED')
    scope.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.subjects(...A, {}), 'FORBIDDEN')
  })
})

describe('newsletter2 AI: edge branches', () => {
  it('formats a priced product without currency and a post without date', async () => {
    const message = buildDraftMessage({
      brief: 'Pedido',
      posts: [],
      articles: [],
      products: [
        {
          id: 'pr1',
          name: 'Plano',
          description: null,
          unitPrice: { toString: () => '10' },
          currency: '',
        },
      ],
    })
    expect(message).toContain('R$')
    repo.listRecentPosts.mockResolvedValueOnce(
      ok([{ id: 'p1', title: 'Post', publishedAt: null, site: { name: 'S' } }]),
    )
    repo.listProducts.mockResolvedValueOnce(ok([]))
    repo.listKbArticles.mockResolvedValueOnce(ok([]))
    expect(
      expectOk(await Service.sources('u1', 'ws1', 'nl1', NOW)).posts[0]
        .publishedAt,
    ).toBeNull()
  })

  it('uses the auto excerpt of a post without one', async () => {
    repo.findPosts.mockResolvedValueOnce(ok([{ ...POST, excerpt: null }]))
    const result = expectOk(
      await Service.draft(...A, dto({ postIds: ['p1'] }), NOW),
    )
    expect(JSON.stringify(result.sections[1])).toContain('Auto')
  })

  it('fails subjects on unparsable output', async () => {
    provider.chat.mockResolvedValueOnce(chat('nada'))
    expectErr(await Service.subjects(...A, {}), 'CRM_NEWSLETTER_AI_FAILED')
  })
})
