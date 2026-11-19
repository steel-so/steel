import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { aiQuotaExceeded, notFound } from '@/src/errors'
import {
  BANNER_TEMPLATES,
  buildBannerDocument,
} from '@/src/lib/banners/templates'
import { err, ok } from '@/src/lib/result'
import {
  BannerAiBriefSchema,
  type CrmBannerAiBriefInput,
} from '@/src/schemas/crm-banner.schema'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-banner.repository')
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/services/feature-flag.service')

import { CrmBannerRepository } from '@/src/repositories/crm-banner.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { AiUsageService } from '@/src/services/ai-usage.service'
import { assertFeature } from '@/src/services/feature-flag.service'
import {
  buildBannerAiSystem,
  CrmBannerService,
  fitCopy,
  normalizeCopy,
} from '../crm-banner.service'

const membership = vi.mocked(MembershipRepository)
const repo = vi.mocked(CrmBannerRepository)
const ai = vi.mocked(AiUsageService)
const feature = vi.mocked(assertFeature)

const WS = 'ws1'
const ACTOR = 'u1'

const template = BANNER_TEMPLATES[0]
if (!template) throw new Error('no template')
const document = buildBannerDocument({
  template,
  brand: { companyName: 'Acme', logoUrl: '', primaryColor: '#2563eb' },
  formatIds: ['gdn-300x250'],
})

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    workspaceId: WS,
    name: 'Verão',
    folder: '',
    tags: [],
    objective: null,
    document,
    createdById: ACTOR,
    updatedById: null,
    createdAt: new Date('2026-11-19T10:00:00Z'),
    updatedAt: new Date('2026-11-19T10:00:00Z'),
    deletedAt: null,
    ...overrides,
  } as never
}

const provider = { id: 'anthropic' as const, chat: vi.fn() }

function chat(text: string) {
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant' as const, content: text },
    usage: { inputTokens: 100, outputTokens: 60 },
    stopReason: 'end' as const,
  }
}

function brief(overrides: CrmBannerAiBriefInput = { mode: 'BANNER' }) {
  return BannerAiBriefSchema.parse(overrides)
}

beforeEach(() => {
  vi.clearAllMocks()
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
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
})

describe('fitCopy() and normalizeCopy()', () => {
  it('keeps short text and trims blanks', () => {
    expect(fitCopy('  Compre   agora ', 24)).toBe('Compre agora')
  })

  it('cuts long text on a word boundary', () => {
    expect(fitCopy('Aproveite as melhores ofertas da semana', 24)).toBe(
      'Aproveite as melhores',
    )
  })

  it('applies the per-field limits', () => {
    const copy = normalizeCopy({
      headline: 'a '.repeat(80),
      subheadline: 'b '.repeat(120),
      cta: 'Quero participar do evento agora mesmo',
      badge: '',
    })
    expect(copy.headline.length).toBeLessThanOrEqual(60)
    expect(copy.subheadline.length).toBeLessThanOrEqual(120)
    expect(copy.cta.length).toBeLessThanOrEqual(24)
  })
})

describe('buildBannerAiSystem()', () => {
  it('asks for one option in BANNER mode with the briefing', () => {
    const system = buildBannerAiSystem(
      brief({
        mode: 'BANNER',
        description: 'Plano de fibra para empresas',
        offer: '3 meses com 50%',
        tone: 'URGENT',
        objective: 'PROMOTION',
        companyName: 'Acme',
      }),
    )
    expect(system).toContain('exatamente 1 opção')
    expect(system).toContain('Plano de fibra para empresas')
    expect(system).toContain('3 meses com 50%')
    expect(system).toContain('Tom: Urgente.')
    expect(system).toContain('Objetivo da campanha: Promoção.')
    expect(system).toContain('Empresa: Acme.')
  })

  it('asks for A/B variants of the current text', () => {
    const system = buildBannerAiSystem(
      brief({
        mode: 'VARIANTS',
        count: 4,
        current: {
          headline: 'Internet rápida',
          subheadline: '',
          cta: 'Assine',
        },
      }),
    )
    expect(system).toContain('exatamente 4 opções')
    expect(system).toContain('teste A/B')
    expect(system).toContain('headline: Internet rápida')
  })
})

describe('CrmBannerService CRUD', () => {
  it('lists with the cover format only and the format count', async () => {
    repo.listByWorkspace.mockResolvedValue(
      ok([
        row({
          document: buildBannerDocument({
            template,
            brand: { companyName: '', logoUrl: '', primaryColor: '#2563eb' },
            formatIds: ['gdn-300x250', 'gdn-728x90'],
          }),
        }),
      ]),
    )
    const result = expectOk(await CrmBannerService.list(ACTOR, WS))
    expect(result[0]?.document.formats).toHaveLength(1)
    expect(result[0]?.formatCount).toBe(2)
    expect(result[0]?.formatIds).toEqual(['gdn-300x250', 'gdn-728x90'])
  })

  it('denies a non-member', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await CrmBannerService.list(ACTOR, WS), 'FORBIDDEN')
  })

  it('creates with the actor as author', async () => {
    repo.create.mockResolvedValue(ok(row()))
    expectOk(
      await CrmBannerService.create(ACTOR, WS, {
        name: 'Verão',
        folder: '',
        tags: [],
        objective: null,
        document,
      }),
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, createdById: ACTOR }),
    )
  })

  it('returns not found when updating a banner of another workspace', async () => {
    repo.findById.mockResolvedValue(err(notFound('CrmBanner')))
    expectErr(
      await CrmBannerService.update(ACTOR, WS, 'x', { name: 'Novo' }),
      'RESOURCE_NOT_FOUND',
    )
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('duplicates keeping document, folder and tags', async () => {
    repo.findById.mockResolvedValue(
      ok(row({ folder: 'Verão', tags: ['a'], objective: 'SALES' })),
    )
    repo.create.mockResolvedValue(ok(row({ id: 'b2' })))
    expectOk(await CrmBannerService.duplicate(ACTOR, WS, 'b1'))
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Verão (cópia)',
        folder: 'Verão',
        tags: ['a'],
        objective: 'SALES',
      }),
    )
  })

  it('soft deletes after checking ownership by workspace', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'ADMIN' })),
    )
    repo.findById.mockResolvedValue(ok(row()))
    repo.softDelete.mockResolvedValue(ok(undefined))
    expectOk(await CrmBannerService.remove(ACTOR, WS, 'b1'))
    expect(repo.findById).toHaveBeenCalledWith('b1', WS)
    expect(repo.softDelete).toHaveBeenCalledWith('b1', ACTOR)
  })

  it('does not let a MEMBER delete (permission matrix)', async () => {
    expectErr(await CrmBannerService.remove(ACTOR, WS, 'b1'), 'FORBIDDEN')
    expect(repo.softDelete).not.toHaveBeenCalled()
  })
})

describe('CrmBannerService.generateCopy()', () => {
  it('returns normalized variants and the image idea, recording usage', async () => {
    provider.chat.mockResolvedValue(
      chat(
        JSON.stringify({
          imageIdea: 'Equipe sorrindo diante de um notebook',
          variants: [
            {
              headline: 'Internet que acompanha o seu negócio',
              subheadline: 'Fibra de verdade',
              cta: 'Assine',
              badge: '',
            },
            { headline: '  ', subheadline: '', cta: '', badge: '' },
          ],
        }),
      ),
    )
    const result = expectOk(
      await CrmBannerService.generateCopy(
        ACTOR,
        WS,
        brief({ mode: 'VARIANTS', count: 3, current: { headline: 'x' } }),
      ),
    )
    expect(result.variants).toHaveLength(1)
    expect(result.imageIdea).toContain('notebook')
    expect(ai.record).toHaveBeenCalled()
  })

  it('keeps one option in BANNER mode', async () => {
    provider.chat.mockResolvedValue(
      chat(
        JSON.stringify({
          imageIdea: '',
          variants: [
            { headline: 'A', subheadline: '', cta: 'Ir', badge: '' },
            { headline: 'B', subheadline: '', cta: 'Ir', badge: '' },
          ],
        }),
      ),
    )
    const result = expectOk(
      await CrmBannerService.generateCopy(ACTOR, WS, brief()),
    )
    expect(result.variants).toHaveLength(1)
  })

  it('fails when the feature is off, without calling the provider', async () => {
    feature.mockResolvedValue(err(aiQuotaExceeded(1, 1)))
    expectErr(
      await CrmBannerService.generateCopy(ACTOR, WS, brief()),
      'AI_QUOTA_EXCEEDED',
    )
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('returns CRM_TEXT_AI_FAILED on invalid output', async () => {
    provider.chat.mockResolvedValue(chat('não é json'))
    expectErr(
      await CrmBannerService.generateCopy(ACTOR, WS, brief()),
      'CRM_TEXT_AI_FAILED',
    )
  })

  it('returns CRM_TEXT_AI_FAILED when the provider throws', async () => {
    provider.chat.mockRejectedValue(new Error('boom'))
    expectErr(
      await CrmBannerService.generateCopy(ACTOR, WS, brief()),
      'CRM_TEXT_AI_FAILED',
    )
  })
})

describe('CrmBannerService.fetchImage()', () => {
  it('refuses URLs outside the media storage', async () => {
    expectErr(
      await CrmBannerService.fetchImage(
        ACTOR,
        WS,
        'https://evil.example/x.png',
      ),
      'BAD_REQUEST',
    )
  })
})
