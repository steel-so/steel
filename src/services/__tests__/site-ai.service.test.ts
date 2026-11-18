import type { Role } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmFormDTO } from '@/src/__tests__/factories/crm-form.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSite,
  createFakeSitePage,
  createSiteDocument,
} from '@/src/__tests__/factories/site.factory'
import {
  bpForm,
  bpSection,
  bpText,
  fakeCapture,
  fakeDesignSpec,
  fakeHeroBlueprint,
} from '@/src/__tests__/factories/site-fidelity.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  aiQuotaExceeded,
  databaseError,
  featureNotEnabled,
  forbidden,
  rateLimited,
  storageError,
} from '@/src/errors'
import type { AiChatRequest, AiChatResponse } from '@/src/lib/ai/types'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  image,
  section,
  toDocument,
} from '@/src/lib/canvas-site/presets/builder'
import { err, ok } from '@/src/lib/result'
import { registerCapturePort } from '@/src/lib/site-ai/fidelity/capture-port'
import { validateSiteDocument } from '@/src/lib/sites/document'
import {
  type GenerateSiteInput,
  GenerateSiteSchema,
  GenerateSiteSectionSchema,
  RewriteSitePageSchema,
  SuggestSiteImagesSchema,
} from '@/src/schemas/site-ai.schema'
import type { SiteAiEvent } from '@/types/site-ai'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/site-page.repository')
vi.mock('@/src/repositories/site-ai.repository')
vi.mock('@/src/repositories/crm-email-builder.repository')
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/services/feature-flag.service')
vi.mock('@/src/services/crm-form.service')
vi.mock('@/src/services/platform-ai-settings.service')
vi.mock('@/src/services/site-media.service')
vi.mock('@/lib/axiom/audit')
vi.mock('@/src/lib/rate-limit', () => ({
  consume: vi.fn(),
  siteInspirationUserLimiter: { name: 'user' },
  siteInspirationWorkspaceLimiter: { name: 'workspace' },
}))
vi.mock('@/src/services/ai-model-options', () => ({
  listUsableAiModels: vi.fn(),
}))
vi.mock('@/src/lib/site-inspiration/read', async (original) => ({
  ...(await original<typeof import('@/src/lib/site-inspiration/read')>()),
  readInspirationLink: vi.fn(),
}))
vi.mock('@/src/lib/sites/document', async (original) => {
  const actual = await original<typeof import('@/src/lib/sites/document')>()
  return {
    ...actual,
    validateSiteDocument: vi.fn(actual.validateSiteDocument),
  }
})
vi.mock('@/src/lib/ai', async (original) => ({
  ...(await original<typeof import('@/src/lib/ai')>()),
  isAiProviderConfigured: vi.fn(() => true),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { isAiProviderConfigured } from '@/src/lib/ai'
import { consume } from '@/src/lib/rate-limit'
import { readInspirationLink } from '@/src/lib/site-inspiration/read'
import { AiUsageRepository } from '@/src/repositories/ai-settings.repository'
import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteAiRepository } from '@/src/repositories/site-ai.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import { listUsableAiModels } from '@/src/services/ai-model-options'
import { AiUsageService } from '@/src/services/ai-usage.service'
import { CrmFormService } from '@/src/services/crm-form.service'
import { assertFeature } from '@/src/services/feature-flag.service'
import { PlatformAiSettingsService } from '@/src/services/platform-ai-settings.service'
import { SiteMediaService } from '@/src/services/site-media.service'
import { MAX_SITES_PER_WORKSPACE } from '../site.service'
import {
  FIDELITY_PROVIDER_TIMEOUT_MS,
  MAX_REWRITE_SLOTS,
  SiteAiService,
} from '../site-ai.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const pages = vi.mocked(SitePageRepository)
const data = vi.mocked(SiteAiRepository)
const brandRepo = vi.mocked(CrmEmailBuilderRepository)
const usageRepo = vi.mocked(AiUsageRepository)
const ai = vi.mocked(AiUsageService)
const feature = vi.mocked(assertFeature)
const forms = vi.mocked(CrmFormService)
const platform = vi.mocked(PlatformAiSettingsService)
const media = vi.mocked(SiteMediaService)
const audit = vi.mocked(auditMutation)
const limiter = vi.mocked(consume)
const readLink = vi.mocked(readInspirationLink)
const usableModels = vi.mocked(listUsableAiModels)
const providerConfigured = vi.mocked(isAiProviderConfigured)
const validate = vi.mocked(validateSiteDocument)
const invalid = () => err(['Documento inválido'])
const actualDocument = await vi.importActual<
  typeof import('@/src/lib/sites/document')
>('@/src/lib/sites/document')

const WS = 'ws1'
const ACTOR = 'u1'
const site = createFakeSite({
  id: 'site1',
  workspaceId: WS,
  name: 'Pão & Cia',
  slug: 'pao-e-cia',
  homePageId: 'home',
  theme: { buttons: { radius: 999 } },
})

// ─── fake provider ───────────────────────────────────────────────────────

function respond(payload: unknown): AiChatResponse {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant', content: text },
    usage: { inputTokens: 1000, outputTokens: 500 },
    stopReason: 'end',
  }
}

/** Fields for every slot id listed in the request (icons get a real
 * icon name). */
function fieldsFor(request: AiChatRequest) {
  const content = String(request.messages[0].content)
  return [...content.matchAll(/^- (t\d+) \[([^,\]]+)/gm)].map(
    ([, id, role]) => ({
      id,
      text: role === 'Ícone' ? 'star' : `Copy ${id}`,
    }),
  )
}

const PLAN = {
  siteName: 'Pão & Cia',
  tagline: 'Pão fresco todo dia',
  ctaLabel: 'Peça já',
  style: 'b2b',
  palette: {
    primary: '#aa3300',
    secondary: '#00aa00',
    accent: '#0000aa',
    dark: '#111111',
  },
  fonts: { heading: 'serif', body: 'geist' },
  pages: [
    {
      kind: 'home',
      title: 'Início',
      sections: ['hero', 'products', 'services'],
    },
    { kind: 'about', title: 'Quem somos', sections: ['about', 'testimonials'] },
    { kind: 'contact', title: 'Contato', sections: ['contact'] },
  ],
}

const overrides: Record<string, (request: AiChatRequest) => unknown> = {}

const chat = vi.fn(async (request: AiChatRequest) => {
  const name = request.jsonSchema?.name ?? ''
  if (overrides[name]) return respond(overrides[name](request))
  switch (name) {
    case 'site_plan':
      return respond(PLAN)
    case 'site_page_copy':
      return respond({
        seoTitle: 'Pão & Cia — padaria',
        seoDescription: 'A melhor padaria do bairro',
        fields: fieldsFor(request),
      })
    case 'site_section_choice':
      return respond({ reply: 'Três serviços.', section: 'services' })
    case 'site_images': {
      const ids = [
        ...String(request.messages[0].content).matchAll(/^- (i\d+):/gm),
      ].map((match) => match[1])
      return respond({
        images: ids.map((id) => ({
          id,
          candidate: 'p2',
          alt: 'Padeiro sorrindo',
          idea: 'Foto do padeiro no forno',
        })),
      })
    }
    default:
      return respond({ fields: fieldsFor(request) })
  }
})

const provider = { id: 'anthropic' as const, chat, chatStream: vi.fn() }

const CLAUDE_MODEL = {
  key: 'anthropic:claude-sonnet-5',
  provider: 'anthropic' as const,
  providerLabel: 'Anthropic (Claude)',
  label: 'Claude Sonnet 5',
  inputUsdPer1M: 2,
  outputUsdPer1M: 10,
}
const GPT_MODEL = {
  key: 'openai:gpt-5-mini',
  provider: 'openai' as const,
  providerLabel: 'OpenAI',
  label: 'GPT-5 mini',
  inputUsdPer1M: 0.25,
  outputUsdPer1M: 2,
}

function asRole(role: Role) {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  limiter.mockResolvedValue(ok(undefined))
  usableModels.mockResolvedValue([CLAUDE_MODEL, GPT_MODEL])
  for (const key of Object.keys(overrides)) delete overrides[key]
  validate.mockImplementation(actualDocument.validateSiteDocument)
  asRole('MEMBER')
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
  ai.price.mockReturnValue(0.01)
  sites.findById.mockResolvedValue(ok(site))
  sites.countByWorkspace.mockResolvedValue(ok(1))
  sites.isSlugTaken.mockResolvedValue(ok(false))
  sites.createWithPages.mockImplementation(async ({ site: row }) =>
    ok(createFakeSite({ id: 'new-site', ...(row as object) })),
  )
  pages.listBySite.mockResolvedValue(
    ok([
      createFakeSitePage({ id: 'home', siteId: site.id, slug: 'inicio' }),
      createFakeSitePage({ id: 'contact', siteId: site.id, slug: 'contato' }),
    ]),
  )
  data.listProducts.mockResolvedValue(
    ok([
      {
        id: 'p1',
        name: 'Pão de fermentação natural',
        description: 'Feito na hora',
        unitPrice: new Prisma.Decimal(18),
        currency: 'BRL',
      },
    ]),
  )
  forms.getById.mockResolvedValue(
    ok(
      createFakeCrmFormDTO({
        id: 'form1',
        status: 'PUBLISHED',
        publicToken: 'tok_form1',
      }),
    ),
  )
})

const brief = (input: Partial<GenerateSiteInput> = {}) =>
  GenerateSiteSchema.parse({
    name: 'Pão & Cia',
    business: 'Padaria artesanal com fermentação natural',
    goal: 'leads',
    tone: 'friendly',
    pages: ['about', 'contact'],
    productIds: ['p1'],
    contactFormId: 'form1',
    ...input,
  })

async function collect(
  stream: AsyncIterable<SiteAiEvent>,
): Promise<SiteAiEvent[]> {
  const events: SiteAiEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

type CreateInput = Parameters<typeof SiteRepository.createWithPages>[0]

function created(): CreateInput {
  return sites.createWithPages.mock.calls[0][0]
}

// ─── context ─────────────────────────────────────────────────────────────

describe('SiteAiService.context', () => {
  beforeEach(() => {
    brandRepo.findBrand.mockResolvedValue(ok(null))
    brandRepo.findWorkspaceIdentity.mockResolvedValue(
      ok({ name: 'Padaria Workspace', logoUrl: 'https://cdn/logo.png' }),
    )
    forms.list.mockResolvedValue(
      ok([
        createFakeCrmFormDTO({
          id: 'f1',
          name: 'Contato',
          status: 'PUBLISHED',
        }),
        createFakeCrmFormDTO({ id: 'f2', status: 'DRAFT' }),
      ]),
    )
    ai.resolveModel.mockResolvedValue(
      ok({
        settings: { monthlyQuotaUsd: 10 } as never,
        model: {
          key: 'anthropic:claude-sonnet',
          provider: 'anthropic',
          model: 'claude-sonnet',
          label: 'Claude Sonnet',
          pricing: { inputUsdPer1M: 3, outputUsdPer1M: 15 },
        } as never,
      }),
    )
    usageRepo.sumSince.mockResolvedValue(
      ok({ costUsd: 2.345, inputTokens: 0, outputTokens: 0 } as never),
    )
    platform.getCostMargin.mockResolvedValue(1)
    providerConfigured.mockReturnValue(true)
  })

  it('prefills the brief and shows quota and estimate', async () => {
    const context = expectOk(await SiteAiService.context(ACTOR, WS))
    expect(context.available).toBe(true)
    expect(context.unavailableReason).toBeNull()
    expect(context.brand).toEqual({
      companyName: 'Padaria Workspace',
      logoUrl: 'https://cdn/logo.png',
      primaryColor: '',
      website: '',
    })
    expect(context.products).toEqual([
      {
        id: 'p1',
        name: 'Pão de fermentação natural',
        description: 'Feito na hora',
        price: expect.stringContaining('18,00'),
      },
    ])
    expect(context.forms).toEqual([
      expect.objectContaining({ id: 'f1', name: 'Contato' }),
    ])
    expect(context.canCreateForm).toBe(true)
    expect(context.quota).toEqual({
      usedUsd: 2.35,
      quotaUsd: 10,
      remainingUsd: 7.65,
      exceeded: false,
    })
    expect(context.estimate).toMatchObject({ model: 'Claude Sonnet' })
    expect(context.estimate?.pageUsd).toBeGreaterThan(0)
  })

  it('uses the saved e-mail brand and survives a forms permission denial', async () => {
    brandRepo.findBrand.mockResolvedValue(
      ok({
        companyName: ' Pão & Cia ',
        logoUrl: '',
        primaryColor: '#AA3300',
        website: 'https://pao.com',
      } as never),
    )
    brandRepo.findWorkspaceIdentity.mockResolvedValue(
      ok({ name: 'WS', logoUrl: null }),
    )
    forms.list.mockResolvedValue(err(forbidden()))
    asRole('VIEWER')
    const context = expectOk(await SiteAiService.context(ACTOR, WS))
    expect(context.brand).toEqual({
      companyName: 'Pão & Cia',
      logoUrl: '',
      primaryColor: '#AA3300',
      website: 'https://pao.com',
    })
    expect(context.forms).toEqual([])
    expect(context.canCreateForm).toBe(false)
  })

  it('explains why the AI is unavailable', async () => {
    feature.mockResolvedValue(err(featureNotEnabled()))
    let context = expectOk(await SiteAiService.context(ACTOR, WS))
    expect(context.available).toBe(false)
    expect(context.unavailableReason).toContain('plano')

    feature.mockResolvedValue(ok(true))
    providerConfigured.mockReturnValue(false)
    context = expectOk(await SiteAiService.context(ACTOR, WS))
    expect(context.available).toBe(false)
    expect(context.unavailableReason).toContain('Ajustes > Steel IA')

    ai.resolveModel.mockResolvedValue(
      ok({ settings: { monthlyQuotaUsd: 1 } as never, model: null }),
    )
    usageRepo.sumSince.mockResolvedValue(ok({ costUsd: 1 } as never))
    context = expectOk(await SiteAiService.context(ACTOR, WS))
    expect(context.estimate).toBeNull()
    expect(context.quota.exceeded).toBe(true)
    expect(context.quota.remainingUsd).toBe(0)
  })

  it('propagates permission and database errors', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await SiteAiService.context(ACTOR, WS))
    asRole('MEMBER')

    const failures: Array<() => void> = [
      () => brandRepo.findBrand.mockResolvedValueOnce(err(databaseError())),
      () =>
        brandRepo.findWorkspaceIdentity.mockResolvedValueOnce(
          err(databaseError()),
        ),
      () => data.listProducts.mockResolvedValueOnce(err(databaseError())),
      () => ai.resolveModel.mockResolvedValueOnce(err(databaseError())),
      () => usageRepo.sumSince.mockResolvedValueOnce(err(databaseError())),
    ]
    for (const fail of failures) {
      fail()
      expectErr(await SiteAiService.context(ACTOR, WS), 'DATABASE_ERROR')
    }
  })
})

// ─── generateSite ────────────────────────────────────────────────────────

describe('SiteAiService.generateSite', () => {
  it('streams the steps and stores a valid site with globals and SEO', async () => {
    const stream = expectOk(
      await SiteAiService.generateSite(ACTOR, WS, brief()),
    )
    const events = await collect(stream)
    expect(events[0]).toMatchObject({
      type: 'steps',
      steps: [
        { id: 'theme', status: 'pending' },
        { id: 'page:home' },
        { id: 'page:about' },
        { id: 'page:contact' },
        { id: 'globals' },
        { id: 'save' },
      ],
    })
    const done = events.at(-1)
    expect(done).toMatchObject({ type: 'done', warnings: [] })
    if (done?.type !== 'done') return
    expect(done.site.id).toBe('new-site')
    expect(done.costUsd).toBeCloseTo(0.04)
    for (const id of [
      'theme',
      'page:home',
      'page:about',
      'page:contact',
      'save',
    ]) {
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'step', id, status: 'done' }),
      )
    }

    const input = created()
    expect(input.site).toMatchObject({
      workspaceId: WS,
      createdById: ACTOR,
      name: 'Pão & Cia',
      slug: 'pao-cia',
    })
    const theme = input.site.theme as { colors: Record<string, string> }
    expect(theme.colors.primary).toBe('#aa3300')
    expect(input.pages.map((page) => [page.slug, page.isHome])).toEqual([
      ['inicio', true],
      ['sobre', false],
      ['contato', false],
    ])
    expect(input.pages[0].seo).toEqual({
      title: 'Pão & Cia — padaria',
      description: 'A melhor padaria do bairro',
    })
    for (const page of input.pages) {
      expect(validateSiteDocument(page.document).ok).toBe(true)
    }
    expect(input.globals.map((global) => global.kind)).toEqual([
      'HEADER',
      'FOOTER',
    ])

    // Copy written by the model, CRM data kept, links to the contact page.
    const home = input.pages[0].document as unknown as CanvasDocument
    const homeNodes = Object.values(home.nodes)
    expect(homeNodes.some((node) => node.props.text === 'Copy t1')).toBe(true)
    expect(
      homeNodes.some((node) =>
        String(node.props.html ?? '').includes('Feito na hora'),
      ),
    ).toBe(true)
    const contactId = input.pages[2].id
    const links = homeNodes
      .map((node) => node.props.link as { type: string; value: string })
      .filter(Boolean)
    expect(links.every((link) => link.type !== 'anchor')).toBe(true)
    expect(links).toContainEqual({ type: 'page', value: contactId })

    const contact = input.pages[2].document as unknown as CanvasDocument
    const form = Object.values(contact.nodes).find(
      (node) => node.type === SITE_TYPES.form,
    )
    expect(form?.props.formToken).toBe('tok_form1')

    expect(ai.record).toHaveBeenCalledTimes(4)
    expect(ai.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: WS, scope: { module: 'CRM' } }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'site',
        action: 'create',
        targetId: 'new-site',
        meta: expect.objectContaining({ ai: true, pages: 3 }),
      }),
    )
  })

  it('creates the contact form when asked and warns without one', async () => {
    forms.create.mockResolvedValue(
      ok(createFakeCrmFormDTO({ id: 'nf', publicToken: 'tok_new' })),
    )
    forms.setPublished.mockResolvedValue(
      ok(
        createFakeCrmFormDTO({
          id: 'nf',
          publicToken: 'tok_new',
          status: 'PUBLISHED',
        }),
      ),
    )
    let events = await collect(
      expectOk(
        await SiteAiService.generateSite(
          ACTOR,
          WS,
          brief({
            contactFormId: undefined,
            createContactForm: true,
            pages: [],
          }),
        ),
      ),
    )
    expect(events.at(-1)).toMatchObject({ type: 'done', warnings: [] })
    expect(forms.create).toHaveBeenCalledWith(
      ACTOR,
      WS,
      expect.objectContaining({ name: 'Contato pelo site', action: 'LEAD' }),
    )
    const home = created().pages[0].document as unknown as CanvasDocument
    expect(
      Object.values(home.nodes).find((node) => node.type === SITE_TYPES.form)
        ?.props.formToken,
    ).toBe('tok_new')

    sites.createWithPages.mockClear()
    forms.setPublished.mockResolvedValueOnce(err(databaseError()))
    events = await collect(
      expectOk(
        await SiteAiService.generateSite(
          ACTOR,
          WS,
          brief({ contactFormId: undefined, createContactForm: true }),
        ),
      ),
    )
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      warnings: [expect.stringContaining('Não foi possível criar')],
    })

    forms.create.mockResolvedValue(err(forbidden()))
    events = await collect(
      expectOk(
        await SiteAiService.generateSite(
          ACTOR,
          WS,
          brief({ contactFormId: undefined, createContactForm: true }),
        ),
      ),
    )
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      warnings: [expect.stringContaining('Não foi possível criar')],
    })

    events = await collect(
      expectOk(
        await SiteAiService.generateSite(
          ACTOR,
          WS,
          brief({ contactFormId: undefined }),
        ),
      ),
    )
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      warnings: [expect.stringContaining('ainda não tem formulário')],
    })
  })

  it('falls back to the default plan and sample copy when the model fails', async () => {
    overrides.site_plan = () => 'sem json'
    overrides.site_page_copy = (request) => ({
      seoTitle: '',
      seoDescription: '',
      fields: fieldsFor(request).slice(0, 1),
    })
    const events = await collect(
      expectOk(
        await SiteAiService.generateSite(
          ACTOR,
          WS,
          brief({ pages: ['faq'], productIds: [] }),
        ),
      ),
    )
    const done = events.at(-1)
    expect(done?.type).toBe('done')
    if (done?.type !== 'done') return
    expect(done.warnings[0]).toContain('não sugeriu um tema')
    expect(done.warnings.some((w) => w.includes('texto do modelo'))).toBe(true)
    expect(created().pages[0].seo).toEqual({})
  })

  it('keeps a page with sample copy when the answer never parses', async () => {
    overrides.site_page_copy = () => 'não'
    const events = await collect(
      expectOk(
        await SiteAiService.generateSite(ACTOR, WS, brief({ pages: [] })),
      ),
    )
    const done = events.at(-1)
    expect(done?.type === 'done' && done.warnings[0]).toContain(
      'não escreveu os textos',
    )
    const home = created().pages[0].document as unknown as CanvasDocument
    // Sample copy stays, but never the presets' sample brand.
    const text = JSON.stringify(home)
    expect(text).not.toContain('Aurora')
    expect(text).toContain('Torne sua empresa mais forte')
  })

  it('aborts with an error event when the provider fails', async () => {
    chat.mockRejectedValueOnce(new Error('timeout'))
    let events = await collect(
      expectOk(await SiteAiService.generateSite(ACTOR, WS, brief())),
    )
    expect(events.at(-2)).toMatchObject({ id: 'theme', status: 'failed' })
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      code: 'SITE_AI_FAILED',
    })

    overrides.site_page_copy = () => {
      throw new Error('down')
    }
    events = await collect(
      expectOk(await SiteAiService.generateSite(ACTOR, WS, brief())),
    )
    expect(events).toContainEqual(
      expect.objectContaining({ id: 'page:home', status: 'failed' }),
    )
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      code: 'SITE_AI_FAILED',
    })
    expect(sites.createWithPages).not.toHaveBeenCalled()
  })

  it('drops invalid sections and globals, and aborts on an invalid page', async () => {
    // keepValidSections checks each section alone, then the page; the
    // globals are checked after the pages.
    let calls = 0
    validate.mockImplementation((input) => {
      calls++
      // First section of the home page fails on its own.
      if (calls === 1) return invalid()
      const nodes = (input as CanvasDocument).nodes
      const isGlobal = Object.values(nodes).some(
        (node) =>
          node.meta?.name === 'Rodapé' || node.meta?.name === 'Cabeçalho',
      )
      return isGlobal ? invalid() : ok(input as CanvasDocument)
    })
    let events = await collect(
      expectOk(
        await SiteAiService.generateSite(ACTOR, WS, brief({ pages: [] })),
      ),
    )
    const done = events.at(-1)
    expect(done?.type).toBe('done')
    if (done?.type !== 'done') return
    expect(done.warnings).toEqual([
      'A seção "Destaque principal" da página Início foi descartada.',
      'Não foi possível montar o cabeçalho.',
      'Não foi possível montar o rodapé.',
    ])
    expect(created().globals).toEqual([])

    validate.mockImplementation(() => invalid())
    events = await collect(
      expectOk(
        await SiteAiService.generateSite(ACTOR, WS, brief({ pages: [] })),
      ),
    )
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      code: 'SITE_DOCUMENT_INVALID',
    })
  })

  it('reports non-Error failures and unexpected crashes as AI failures', async () => {
    chat.mockRejectedValueOnce('down')
    let events = await collect(
      expectOk(await SiteAiService.generateSite(ACTOR, WS, brief())),
    )
    expect(events.at(-1)).toMatchObject({ code: 'SITE_AI_FAILED' })

    overrides.site_page_copy = () => {
      throw 'page down'
    }
    events = await collect(
      expectOk(await SiteAiService.generateSite(ACTOR, WS, brief())),
    )
    expect(events.at(-1)).toMatchObject({ code: 'SITE_AI_FAILED' })

    delete overrides.site_page_copy
    // Plan usage recorded, then the ledger blows up on the first page.
    ai.record
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('ledger down'))
    events = await collect(
      expectOk(
        await SiteAiService.generateSite(ACTOR, WS, brief({ pages: [] })),
      ),
    )
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      code: 'SITE_AI_FAILED',
    })
  })

  it('reports a failed save', async () => {
    sites.createWithPages.mockResolvedValue(err(databaseError()))
    const events = await collect(
      expectOk(
        await SiteAiService.generateSite(ACTOR, WS, brief({ pages: [] })),
      ),
    )
    expect(events.at(-2)).toMatchObject({ id: 'save', status: 'failed' })
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      code: 'DATABASE_ERROR',
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    )
  })

  it('checks permission, cap, plan, quota and the chosen form up front', async () => {
    asRole('VIEWER')
    expectErr(await SiteAiService.generateSite(ACTOR, WS, brief()), 'FORBIDDEN')
    asRole('MEMBER')

    sites.countByWorkspace.mockResolvedValueOnce(ok(MAX_SITES_PER_WORKSPACE))
    expectErr(
      await SiteAiService.generateSite(ACTOR, WS, brief()),
      'SITE_LIMIT_REACHED',
    )
    sites.countByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SiteAiService.generateSite(ACTOR, WS, brief()))

    feature.mockResolvedValueOnce(err(featureNotEnabled()))
    expectErr(
      await SiteAiService.generateSite(ACTOR, WS, brief()),
      'FEATURE_NOT_ENABLED',
    )
    ai.prepare.mockResolvedValueOnce(err(aiQuotaExceeded(10, 10)))
    expectErr(
      await SiteAiService.generateSite(ACTOR, WS, brief()),
      'AI_QUOTA_EXCEEDED',
    )

    forms.getById.mockResolvedValueOnce(
      ok(createFakeCrmFormDTO({ status: 'DRAFT' })),
    )
    expectErr(
      await SiteAiService.generateSite(ACTOR, WS, brief()),
      'VALIDATION_ERROR',
    )
    forms.getById.mockResolvedValueOnce(err(forbidden()))
    expectErr(await SiteAiService.generateSite(ACTOR, WS, brief()), 'FORBIDDEN')

    data.listProducts.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SiteAiService.generateSite(ACTOR, WS, brief()))

    sites.isSlugTaken.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SiteAiService.generateSite(ACTOR, WS, brief()))
    expect(chat).not.toHaveBeenCalled()
  })
})

// ─── inspiration links and model choice (ADR 0071) ───────────────────────

const REF_BRIEF = {
  title: 'Ref',
  description: '',
  language: 'pt',
  headings: [{ level: 1 as const, text: 'Título da referência' }],
  sections: ['hero' as const, 'pricing' as const],
  colors: {
    themeColor: '#1a73e8',
    variables: [],
    dominant: ['#1a73e8'],
    background: '#ffffff',
    dark: false,
  },
  fonts: ['Poppins'],
  tone: 'frases curtas e diretas.',
  layout: 'cabeçalho com menu de navegação.',
  truncated: false,
}

const readOk = (url: string) => ({
  url,
  status: 'read' as const,
  message: null,
  brief: REF_BRIEF,
})
const readFailed = (url: string) => ({
  url,
  status: 'failed' as const,
  message: 'O site demorou demais para responder.',
  brief: null,
})

describe('SiteAiService.generateSite — inspiration links', () => {
  const LINKS = ['https://ref.example/a?utm=1', 'https://slow.example/']

  beforeEach(() => {
    readLink.mockImplementation(async (url: string) =>
      url.includes('slow')
        ? readFailed('https://slow.example')
        : readOk('https://ref.example/a'),
    )
  })

  it('reads the links, reports each one and quotes the briefs as data', async () => {
    const stream = expectOk(
      await SiteAiService.generateSite(
        ACTOR,
        WS,
        brief({
          inspirationLinks: LINKS,
          inspirationFocus: 'cores e ordem das seções',
        }),
      ),
    )
    const events = await collect(stream)
    expect(events[0]).toMatchObject({ type: 'steps' })
    const first = events[0]
    if (first.type === 'steps') {
      expect(first.steps.slice(0, 3).map((step) => step.id)).toEqual([
        'inspiration',
        'analysis',
        'theme',
      ])
    }
    const linkEvents = events.filter((event) => event.type === 'link')
    // two "reading" announcements, then one result per link
    expect(linkEvents).toHaveLength(4)
    expect(linkEvents[0]).toMatchObject({
      link: { status: 'reading', url: 'https://ref.example/a' },
    })

    const done = events.at(-1)
    expect(done).toMatchObject({
      type: 'done',
      links: [
        { url: 'https://ref.example/a', status: 'read', message: null },
        { url: 'https://slow.example', status: 'failed' },
      ],
    })
    if (done?.type !== 'done') return
    expect(done.warnings.join(' ')).toContain('https://slow.example')

    // the plan call and every page call carry the quoted brief
    const requests = chat.mock.calls.map(([request]) => request)
    const planCall = requests.find(
      (request) => request.jsonSchema?.name === 'site_plan',
    )
    const planMessage = String(planCall?.messages[0].content)
    expect(planMessage).toContain(
      '<untrusted_content source="web_inspiration">',
    )
    expect(planMessage).toContain('Título da referência')
    expect(planMessage).toContain(
      'O que aproveitar, segundo o cliente: cores e ordem das seções',
    )
    expect(planCall?.system).toContain('Nunca copie')
    const pageCalls = requests.filter(
      (request) => request.jsonSchema?.name === 'site_page_copy',
    )
    expect(pageCalls.length).toBeGreaterThan(0)
    for (const request of pageCalls) {
      expect(String(request.messages[0].content)).toContain('web_inspiration')
      expect(request.system).toContain('ORIGINAIS')
      // the brief travels as data in the user turn, never in the system prompt
      expect(request.system).not.toContain('Título da referência')
    }
  })

  it('keeps generating when every link fails, and sends no inspiration', async () => {
    readLink.mockResolvedValue(readFailed('https://slow.example'))
    const events = await collect(
      expectOk(
        await SiteAiService.generateSite(
          ACTOR,
          WS,
          brief({ inspirationLinks: ['https://slow.example/'] }),
        ),
      ),
    )
    expect(events.at(-1)).toMatchObject({ type: 'done' })
    const finished = events.find(
      (event) =>
        event.type === 'step' &&
        event.id === 'inspiration' &&
        event.status !== 'running',
    )
    expect(finished).toMatchObject({ status: 'failed' })
    for (const [request] of chat.mock.calls) {
      expect(String(request.messages[0].content)).not.toContain(
        'web_inspiration',
      )
      expect(request.system).not.toContain('Nunca copie')
    }
  })

  it('does not touch the network or the limiter without links', async () => {
    await collect(
      expectOk(await SiteAiService.generateSite(ACTOR, WS, brief())),
    )
    expect(readLink).not.toHaveBeenCalled()
    expect(limiter).not.toHaveBeenCalled()
  })

  it('spends one limiter point per link, per user and per workspace', async () => {
    await SiteAiService.generateSite(
      ACTOR,
      WS,
      brief({ inspirationLinks: LINKS }),
    )
    expect(limiter).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'user' }),
      `user:${ACTOR}`,
      2,
    )
    expect(limiter).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workspace' }),
      `workspace:${WS}`,
      2,
    )
  })

  it('rejects before reading anything when the link budget is spent', async () => {
    limiter.mockResolvedValueOnce(err(rateLimited(30)))
    expectErr(
      await SiteAiService.generateSite(
        ACTOR,
        WS,
        brief({ inspirationLinks: LINKS }),
      ),
      'RATE_LIMITED',
    )
    expect(readLink).not.toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
  })

  it('stores the counts, not the pages: settings and audit', async () => {
    await collect(
      expectOk(
        await SiteAiService.generateSite(
          ACTOR,
          WS,
          brief({ inspirationLinks: LINKS }),
        ),
      ),
    )
    expect(created().site.settings).toMatchObject({
      aiGeneration: {
        modelKey: 'anthropic:claude',
        inspirationLinks: 2,
        inspirationRead: 1,
      },
    })
    const logged = JSON.stringify(audit.mock.calls)
    expect(logged).toContain('"inspirationLinks":2')
    expect(logged).toContain('"inspirationRead":1')
    expect(logged).not.toContain('utm=1')
    expect(logged).not.toContain('ref.example')
    expect(JSON.stringify(created())).not.toContain('Título da referência')
  })
})

describe('SiteAiService.generateSite — model choice', () => {
  const resolved = (key: string | null) =>
    ok({
      settings: { monthlyQuotaUsd: 10 } as never,
      model: key
        ? ({
            key,
            provider: key.split(':')[0],
            model: key.split(':')[1],
            label: key,
          } as never)
        : null,
    })

  it('passes the chosen model to the AI layer and records it', async () => {
    ai.resolveModel.mockResolvedValue(resolved('openai:gpt-5-mini'))
    ai.prepare.mockResolvedValue(
      ok({
        feature: 'CRM_ASSISTANT',
        provider: provider as never,
        model: {
          key: 'openai:gpt-5-mini',
          provider: 'openai',
          model: 'gpt-5-mini',
          label: 'GPT-5 mini',
        } as never,
      }),
    )
    const events = await collect(
      expectOk(
        await SiteAiService.generateSite(
          ACTOR,
          WS,
          brief({ modelKey: 'openai:gpt-5-mini' }),
        ),
      ),
    )
    expect(ai.resolveModel).toHaveBeenCalledWith(WS, 'CRM_ASSISTANT', ACTOR, [
      'openai:gpt-5-mini',
    ])
    expect(ai.prepare).toHaveBeenCalledWith(WS, 'CRM_ASSISTANT', ACTOR, [
      'openai:gpt-5-mini',
    ])
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      modelKey: 'openai:gpt-5-mini',
    })
    expect(created().site.settings).toMatchObject({
      aiGeneration: { modelKey: 'openai:gpt-5-mini' },
    })
    expect(JSON.stringify(audit.mock.calls)).toContain('openai:gpt-5-mini')
  })

  it('uses the workspace default when no model is chosen', async () => {
    await SiteAiService.generateSite(ACTOR, WS, brief())
    expect(ai.resolveModel).not.toHaveBeenCalled()
    expect(ai.prepare).toHaveBeenCalledWith(WS, 'CRM_ASSISTANT', ACTOR)
  })

  it('rejects a model the workspace cannot use instead of falling back', async () => {
    // resolution skipped the choice (disabled, or provider without a key)
    ai.resolveModel.mockResolvedValue(resolved('anthropic:claude-sonnet-5'))
    expectErr(
      await SiteAiService.generateSite(
        ACTOR,
        WS,
        brief({ modelKey: 'openai:gpt-5' }),
      ),
      'AI_PROVIDER_UNAVAILABLE',
    )
    ai.resolveModel.mockResolvedValue(resolved(null))
    expectErr(
      await SiteAiService.generateSite(
        ACTOR,
        WS,
        brief({ modelKey: 'openai:gpt-5' }),
      ),
      'AI_PROVIDER_UNAVAILABLE',
    )
    expect(ai.prepare).not.toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
  })

  it('propagates the quota error of the chosen model', async () => {
    ai.resolveModel.mockResolvedValue(resolved('openai:gpt-5-mini'))
    ai.prepare.mockResolvedValueOnce(err(aiQuotaExceeded(10, 10)))
    expectErr(
      await SiteAiService.generateSite(
        ACTOR,
        WS,
        brief({ modelKey: 'openai:gpt-5-mini' }),
      ),
      'AI_QUOTA_EXCEEDED',
    )
  })

  it('checks the plan feature before resolving the model', async () => {
    feature.mockResolvedValueOnce(err(featureNotEnabled()))
    expectErr(
      await SiteAiService.generateSite(
        ACTOR,
        WS,
        brief({ modelKey: 'openai:gpt-5-mini' }),
      ),
      'FEATURE_NOT_ENABLED',
    )
    expect(ai.resolveModel).not.toHaveBeenCalled()
  })

  it('propagates a settings read error', async () => {
    ai.resolveModel.mockResolvedValue(err(databaseError()))
    expectErr(
      await SiteAiService.generateSite(
        ACTOR,
        WS,
        brief({ modelKey: 'openai:gpt-5-mini' }),
      ),
    )
  })
})

describe('SiteAiService.context — model list', () => {
  beforeEach(() => {
    brandRepo.findBrand.mockResolvedValue(ok(null))
    brandRepo.findWorkspaceIdentity.mockResolvedValue(
      ok({ name: 'Padaria', logoUrl: '' }),
    )
    forms.list.mockResolvedValue(ok([]))
    ai.resolveModel.mockResolvedValue(
      ok({
        settings: { monthlyQuotaUsd: 10 } as never,
        model: {
          key: CLAUDE_MODEL.key,
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          label: 'Claude Sonnet 5',
          pricing: { inputUsdPer1M: 2, outputUsdPer1M: 10 },
        } as never,
      }),
    )
    usageRepo.sumSince.mockResolvedValue(
      ok({ costUsd: 0, inputTokens: 0, outputTokens: 0 } as never),
    )
    platform.getCostMargin.mockResolvedValue(1)
    providerConfigured.mockReturnValue(true)
  })

  it('offers the usable models, preselects the default and prices each one', async () => {
    const context = expectOk(await SiteAiService.context(ACTOR, WS))
    expect(context.models.map((model) => model.key)).toEqual([
      CLAUDE_MODEL.key,
      GPT_MODEL.key,
    ])
    expect(context.defaultModelKey).toBe(CLAUDE_MODEL.key)
    expect(Object.keys(context.estimates)).toEqual([
      CLAUDE_MODEL.key,
      GPT_MODEL.key,
    ])
    expect(context.estimates[GPT_MODEL.key].pageUsd).toBeLessThan(
      context.estimates[CLAUDE_MODEL.key].pageUsd,
    )
  })

  it('falls back to the first usable model when the default is not pickable', async () => {
    usableModels.mockResolvedValue([GPT_MODEL])
    const context = expectOk(await SiteAiService.context(ACTOR, WS))
    expect(context.defaultModelKey).toBe(GPT_MODEL.key)
  })

  it('offers nothing when the plan lacks the AI', async () => {
    feature.mockResolvedValue(err(featureNotEnabled()))
    const context = expectOk(await SiteAiService.context(ACTOR, WS))
    expect(context.models).toEqual([])
    expect(context.defaultModelKey).toBeNull()
  })
})

// ─── generateSection ─────────────────────────────────────────────────────

describe('SiteAiService.generateSection', () => {
  const dto = (input = {}) =>
    GenerateSiteSectionSchema.parse({
      prompt: 'Três serviços da padaria',
      pageTitle: 'Início',
      headings: ['Bem-vindo'],
      ...input,
    })

  it('returns a valid section with copy, in the site style', async () => {
    const result = expectOk(
      await SiteAiService.generateSection(ACTOR, WS, site.id, dto()),
    )
    expect(result.reply).toBe('Três serviços.')
    expect(result.costUsd).toBeCloseTo(0.02)
    const fragment = result.fragment
    expect(fragment.nodes[fragment.rootId].type).toBe(SITE_TYPES.section)
    const nodes = Object.values(fragment.nodes)
    expect(nodes.some((node) => node.props.text === 'Copy t2')).toBe(true)
    const links = nodes
      .map((node) => node.props.link as { type: string; value: string })
      .filter(Boolean)
    expect(links).toContainEqual({ type: 'page', value: 'contact' })
    const choice = chat.mock.calls[0][0]
    expect(choice.system).toContain('Bem-vindo')
  })

  it('links to the home page without a contact page and honours the style', async () => {
    pages.listBySite.mockResolvedValueOnce(ok([]))
    overrides.site_section_choice = () => ({ reply: '', section: 'cta' })
    const result = expectOk(
      await SiteAiService.generateSection(
        ACTOR,
        WS,
        site.id,
        dto({ style: 'agency' }),
      ),
    )
    expect(result.reply).toContain('Pronto')
    const button = Object.values(result.fragment.nodes).find(
      (node) => node.type === SITE_TYPES.button,
    )
    expect(button?.props.link).toEqual({ type: 'page', value: 'home' })
  })

  it('falls back to the first page, or nothing, without a home page', async () => {
    overrides.site_section_choice = () => ({ reply: 'x', section: 'cta' })
    sites.findById.mockResolvedValue(ok({ ...site, homePageId: null }))
    pages.listBySite.mockResolvedValueOnce(
      ok([createFakeSitePage({ id: 'first', siteId: site.id, slug: 'sobre' })]),
    )
    const first = expectOk(
      await SiteAiService.generateSection(
        ACTOR,
        WS,
        site.id,
        dto({ pageTitle: '' }),
      ),
    )
    const link = (fragment: typeof first.fragment) =>
      Object.values(fragment.nodes).find(
        (node) => node.type === SITE_TYPES.button,
      )?.props.link
    expect(link(first.fragment)).toEqual({ type: 'page', value: 'first' })

    pages.listBySite.mockResolvedValueOnce(ok([]))
    const none = expectOk(
      await SiteAiService.generateSection(ACTOR, WS, site.id, dto()),
    )
    expect(link(none.fragment)).toEqual({ type: 'page', value: '' })
  })

  it('uses a partial copy and fails without any', async () => {
    overrides.site_section_copy = (request) => ({
      fields: fieldsFor(request).slice(0, 2),
    })
    expectOk(await SiteAiService.generateSection(ACTOR, WS, site.id, dto()))

    overrides.site_section_copy = () => 'nada'
    expectErr(
      await SiteAiService.generateSection(ACTOR, WS, site.id, dto()),
      'SITE_AI_FAILED',
    )

    overrides.site_section_choice = () => ({ reply: 'x', section: 'nope' })
    expectErr(
      await SiteAiService.generateSection(ACTOR, WS, site.id, dto()),
      'SITE_AI_FAILED',
    )
  })

  it('never returns an invalid section', async () => {
    validate.mockReturnValueOnce(invalid())
    expectErr(
      await SiteAiService.generateSection(ACTOR, WS, site.id, dto()),
      'SITE_AI_FAILED',
    )
  })

  it('checks access, plan and quota', async () => {
    asRole('VIEWER')
    expectErr(
      await SiteAiService.generateSection(ACTOR, WS, site.id, dto()),
      'FORBIDDEN',
    )
    asRole('MEMBER')
    sites.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SiteAiService.generateSection(ACTOR, WS, site.id, dto()))
    ai.prepare.mockResolvedValueOnce(err(aiQuotaExceeded(5, 5)))
    expectErr(
      await SiteAiService.generateSection(ACTOR, WS, site.id, dto()),
      'AI_QUOTA_EXCEEDED',
    )
    pages.listBySite.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SiteAiService.generateSection(ACTOR, WS, site.id, dto()))
  })
})

// ─── rewritePage ─────────────────────────────────────────────────────────

describe('SiteAiService.rewritePage', () => {
  const dto = (input = {}) =>
    RewriteSitePageSchema.parse({
      document: createSiteDocument('Título antigo'),
      tone: 'formal',
      length: 'shorter',
      ...input,
    })

  it('returns update changes for the rewritten fields', async () => {
    const result = expectOk(
      await SiteAiService.rewritePage(ACTOR, WS, site.id, dto()),
    )
    expect(result).toEqual({
      changes: [{ nodeId: 'h1', set: { text: 'Copy t1' } }],
      rewritten: 1,
      costUsd: 0.01,
    })
    expect(chat.mock.calls[0][0].system).toContain('"Formal" (mais curto)')
  })

  it('uses a partial answer and fails without one', async () => {
    overrides.site_page_rewrite = () => ({ fields: [] })
    expect(
      expectOk(await SiteAiService.rewritePage(ACTOR, WS, site.id, dto())),
    ).toMatchObject({ changes: [], rewritten: 0 })
    overrides.site_page_rewrite = () => 'x'
    expectErr(
      await SiteAiService.rewritePage(ACTOR, WS, site.id, dto()),
      'SITE_AI_FAILED',
    )
  })

  it('caps the fields and rejects pages without text or invalid ones', async () => {
    const big = createSiteDocument('a')
    const extra = Array.from(
      { length: MAX_REWRITE_SLOTS + 10 },
      (_, i) => `x${i}`,
    )
    big.nodes.s1.children = ['h1', ...extra]
    for (const id of extra) {
      big.nodes[id] = {
        ...big.nodes.h1,
        id,
        props: { ...big.nodes.h1.props, level: 'h2' },
      }
    }
    await SiteAiService.rewritePage(ACTOR, WS, site.id, dto({ document: big }))
    const message = String(chat.mock.calls[0][0].messages[0].content)
    expect(message).toContain(`t${MAX_REWRITE_SLOTS}`)
    expect(message).not.toContain(`t${MAX_REWRITE_SLOTS + 1} `)

    const empty = createSiteDocument()
    empty.nodes.s1.children = []
    delete (empty.nodes as Record<string, unknown>).h1
    expectErr(
      await SiteAiService.rewritePage(
        ACTOR,
        WS,
        site.id,
        dto({ document: empty }),
      ),
      'VALIDATION_ERROR',
    )
    const broken = createSiteDocument()
    broken.nodes.h1.props.level = 'h9'
    const error = expectErr(
      await SiteAiService.rewritePage(
        ACTOR,
        WS,
        site.id,
        dto({ document: broken }),
      ),
      'SITE_DOCUMENT_INVALID',
    )
    expect(error.details).toEqual([expect.any(String)])
  })

  it('checks access and quota', async () => {
    asRole('VIEWER')
    expectErr(
      await SiteAiService.rewritePage(ACTOR, WS, site.id, dto()),
      'FORBIDDEN',
    )
    asRole('MEMBER')
    ai.prepare.mockResolvedValueOnce(err(aiQuotaExceeded(5, 5)))
    expectErr(
      await SiteAiService.rewritePage(ACTOR, WS, site.id, dto()),
      'AI_QUOTA_EXCEEDED',
    )
  })
})

// ─── suggestImages ───────────────────────────────────────────────────────

describe('SiteAiService.suggestImages', () => {
  const pageDoc = () =>
    toDocument([section({}, [image('/old.png', 'Foto antiga')])])
  const dto = (input = {}) =>
    SuggestSiteImagesSchema.parse({ document: pageDoc(), ...input })

  beforeEach(() => {
    media.list.mockResolvedValue(
      ok([
        {
          id: 'a.png',
          url: 'https://media/a.png',
          size: 1,
          source: 'site',
          uploadedAt: null,
        },
        {
          id: 'b.png',
          url: 'https://media/b.png',
          size: 1,
          source: 'site',
          uploadedAt: null,
        },
      ]),
    )
    pages.listWithDocuments.mockResolvedValue(
      ok([
        createFakeSitePage({
          document: toDocument([
            section({}, [image('https://media/a.png', 'Fachada da padaria')]),
          ]) as never,
        }),
      ]),
    )
  })

  it('suggests images from the library and placeholders only', async () => {
    const result = expectOk(
      await SiteAiService.suggestImages(ACTOR, WS, site.id, dto()),
    )
    expect(result.suggestions).toEqual([
      expect.objectContaining({
        currentSrc: '/old.png',
        src: '/landing-page-templates/b2b/hero-portrait.png',
        alt: 'Padeiro sorrindo',
        source: 'placeholder',
      }),
    ])
    const message = String(chat.mock.calls[0][0].messages[0].content)
    expect(message).toContain(
      'b1 (biblioteca do workspace): Fachada da padaria',
    )
    expect(message).toContain('b2 (biblioteca do workspace): imagem enviada')
  })

  it('works without the media library and fails without an answer', async () => {
    media.list.mockResolvedValueOnce(err(storageError('x')))
    expectOk(await SiteAiService.suggestImages(ACTOR, WS, site.id, dto()))
    const message = String(chat.mock.calls[0][0].messages[0].content)
    expect(message).not.toContain('biblioteca do workspace')

    overrides.site_images = () => ({ images: [] })
    expect(
      expectOk(await SiteAiService.suggestImages(ACTOR, WS, site.id, dto()))
        .suggestions,
    ).toEqual([])
    overrides.site_images = () => 'nada'
    expectErr(
      await SiteAiService.suggestImages(ACTOR, WS, site.id, dto()),
      'SITE_AI_FAILED',
    )
  })

  it('rejects pages without images and propagates errors', async () => {
    expectErr(
      await SiteAiService.suggestImages(
        ACTOR,
        WS,
        site.id,
        dto({ document: createSiteDocument() }),
      ),
      'VALIDATION_ERROR',
    )
    const broken = pageDoc()
    broken.nodes.root.props.background = 'bad'
    expectErr(
      await SiteAiService.suggestImages(
        ACTOR,
        WS,
        site.id,
        dto({ document: broken }),
      ),
      'SITE_DOCUMENT_INVALID',
    )
    pages.listWithDocuments.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SiteAiService.suggestImages(ACTOR, WS, site.id, dto()))
    ai.prepare.mockResolvedValueOnce(err(aiQuotaExceeded(1, 1)))
    expectErr(
      await SiteAiService.suggestImages(ACTOR, WS, site.id, dto()),
      'AI_QUOTA_EXCEEDED',
    )
    asRole('VIEWER')
    expectErr(
      await SiteAiService.suggestImages(ACTOR, WS, site.id, dto()),
      'FORBIDDEN',
    )
  })
})

// ─── reference-faithful path ─────────────────────────────────────────────

describe('SiteAiService.generateSite — reference-faithful path', () => {
  const IMAGE = 'data:image/png;base64,AAAA'
  const FIDELITY_PLAN = {
    siteName: 'Pão & Cia',
    tagline: 'Pão fresco todo dia',
    ctaLabel: 'Peça já',
    pages: [
      {
        kind: 'home',
        title: 'Início',
        seoTitle: 'Pão & Cia — início',
        seoDescription: 'Padaria artesanal',
        sections: [
          {
            name: 'Destaque',
            purpose: 'Apresentar a padaria',
            equivalent: 'hero',
            referenceId: 'ref1',
            referenceSection: 0,
          },
          {
            name: 'Serviços',
            purpose: 'O que fazemos',
            equivalent: 'services',
            referenceId: 'ref1',
            referenceSection: 1,
          },
        ],
      },
    ],
  }

  const requestText = (request: AiChatRequest) => {
    const content = request.messages[0].content
    return typeof content === 'string'
      ? content
      : content
          .map((part) => (part.type === 'text' ? part.text : ''))
          .join('\n')
  }
  const callsOf = (name: string) =>
    chat.mock.calls
      .map(([request]) => request)
      .filter((request) => request.jsonSchema?.name === name)

  const preparedWithQuota = () =>
    ok({
      feature: 'CRM_ASSISTANT' as const,
      provider: provider as never,
      model: {
        key: 'anthropic:claude',
        provider: 'anthropic',
        model: 'claude-x',
        label: 'Claude',
      } as never,
      monthlyQuotaUsd: 10,
    })

  beforeEach(() => {
    chat.mockClear()
    overrides.design_spec = () => fakeDesignSpec()
    overrides.fidelity_plan = () => FIDELITY_PLAN
    overrides.section_blueprint = (request) =>
      requestText(request).includes('seção de CONTATO')
        ? bpSection([bpText(), bpForm()], { name: 'Contato' })
        : fakeHeroBlueprint()
  })

  afterEach(() => {
    registerCapturePort(null)
  })

  it('analyzes the pictures, plans from them and draws the sections', async () => {
    const events = await collect(
      expectOk(
        await SiteAiService.generateSite(
          ACTOR,
          WS,
          brief({ inspirationImages: [IMAGE], primaryColor: '#123456' }),
        ),
      ),
    )
    const first = events[0]
    if (first.type !== 'steps') throw new Error('no steps')
    expect(first.steps.slice(0, 2).map((step) => step.id)).toEqual([
      'analysis',
      'theme',
    ])
    for (const id of ['analysis', 'theme', 'page:home', 'page:about']) {
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'step', id, status: 'done' }),
      )
    }
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'step',
        id: 'page:home',
        status: 'running',
        label: expect.stringContaining('Desenhando a seção "Destaque"'),
      }),
    )
    expect(events.at(-1)).toMatchObject({ type: 'done' })

    // no classic plan call: the plan comes from the references
    expect(callsOf('site_plan')).toHaveLength(0)
    expect(callsOf('design_spec')).toHaveLength(1)
    expect(callsOf('fidelity_plan')).toHaveLength(1)
    expect(callsOf('section_blueprint').length).toBeGreaterThanOrEqual(5)
    // the picture goes to the analysis
    const analysis = callsOf('design_spec')[0]
    expect(JSON.stringify(analysis.messages[0].content)).toContain(IMAGE)

    const input = created()
    const theme = input.site.theme as { colors: Record<string, string> }
    expect(theme.colors.primary).toBe('#123456')
    expect(input.pages.map((page) => page.slug)).toEqual([
      'inicio',
      'sobre',
      'contato',
    ])
    expect(input.pages[0].seo).toEqual({
      title: 'Pão & Cia — início',
      description: 'Padaria artesanal',
    })
    const names = (doc: unknown) =>
      Object.values((doc as CanvasDocument).nodes).map(
        (node) => node.meta?.name,
      )
    expect(names(input.pages[0].document)).toContain('Destaque')
    for (const page of input.pages) {
      expect(validateSiteDocument(page.document).ok).toBe(true)
    }
    // the form drawn for the contact section points at the CRM form
    const forms = Object.values(
      (input.pages[2].document as CanvasDocument).nodes,
    ).filter((node) => node.type === SITE_TYPES.form)
    expect(forms).toHaveLength(1)
    expect(forms[0].props.formToken).toBe('tok_form1')
    expect(JSON.stringify(audit.mock.calls)).toContain('"sectionsDrawn"')
    expect(ai.prepare).toHaveBeenCalledWith(WS, 'CRM_ASSISTANT', ACTOR, [], {
      timeoutMs: FIDELITY_PROVIDER_TIMEOUT_MS,
    })
  })

  it('uses the ready sections for any section that cannot be drawn', async () => {
    overrides.section_blueprint = () => bpSection([])
    const events = await collect(
      expectOk(
        await SiteAiService.generateSite(
          ACTOR,
          WS,
          brief({ inspirationImages: [IMAGE] }),
        ),
      ),
    )
    const done = events.at(-1)
    expect(done?.type).toBe('done')
    if (done?.type !== 'done') return
    expect(done.warnings.join(' ')).toContain('modelo pronto')
    for (const page of created().pages) {
      expect(validateSiteDocument(page.document).ok).toBe(true)
    }
    // the ready sections got their copy from the page copy call
    expect(callsOf('site_page_copy').length).toBeGreaterThan(0)
  })

  it('falls back to the classic generation when no reference can be analyzed', async () => {
    overrides.design_spec = () => ({ nope: true })
    const events = await collect(
      expectOk(
        await SiteAiService.generateSite(
          ACTOR,
          WS,
          brief({ inspirationImages: [IMAGE] }),
        ),
      ),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'step',
        id: 'analysis',
        status: 'failed',
      }),
    )
    const done = events.at(-1)
    expect(done?.type).toBe('done')
    if (done?.type !== 'done') return
    expect(done.warnings.join(' ')).toContain('layout das referências')
    expect(callsOf('site_plan')).toHaveLength(1)
    expect(callsOf('section_blueprint')).toHaveLength(0)
  })

  it('captures the links and follows the capture even when the text read fails', async () => {
    const capture = vi.fn(async () => ok(fakeCapture()))
    registerCapturePort({ capture })
    readLink.mockResolvedValue({
      url: 'https://ref.example/a',
      status: 'failed',
      message: 'O site demorou demais para responder.',
      brief: null,
    })
    const events = await collect(
      expectOk(
        await SiteAiService.generateSite(
          ACTOR,
          WS,
          brief({ inspirationLinks: ['https://ref.example/a?utm=1'] }),
        ),
      ),
    )
    expect(capture).toHaveBeenCalledWith('https://ref.example/a?utm=1')
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      links: [{ url: 'https://ref.example/a', status: 'read', message: null }],
    })
    expect(callsOf('design_spec')).toHaveLength(1)
    const parts = callsOf('design_spec')[0].messages[0].content as Array<{
      type: string
    }>
    expect(parts.filter((part) => part.type === 'image')).toHaveLength(3)
  })

  it('keeps the text summary when the capture fails or throws', async () => {
    readLink.mockResolvedValue(readOk('https://ref.example/a'))
    for (const failing of [
      vi.fn(async () => err(databaseError())),
      vi.fn(async () => {
        throw new Error('browser crashed')
      }),
    ]) {
      chat.mockClear()
      registerCapturePort({ capture: failing })
      const events = await collect(
        expectOk(
          await SiteAiService.generateSite(
            ACTOR,
            WS,
            brief({ inspirationLinks: ['https://ref.example/a'] }),
          ),
        ),
      )
      expect(events.at(-1)).toMatchObject({
        type: 'done',
        links: [{ status: 'read' }],
      })
      // the text summary alone still feeds the analysis
      expect(callsOf('design_spec')).toHaveLength(1)
    }
  })

  it('stops drawing when the monthly quota is spent during the run', async () => {
    ai.prepare.mockResolvedValue(preparedWithQuota())
    usageRepo.sumSince.mockResolvedValue(ok({ costUsd: 10 } as never))
    const events = await collect(
      expectOk(
        await SiteAiService.generateSite(
          ACTOR,
          WS,
          brief({ inspirationImages: [IMAGE] }),
        ),
      ),
    )
    const done = events.at(-1)
    expect(done?.type).toBe('done')
    if (done?.type !== 'done') return
    expect(done.warnings.join(' ')).toContain('cota mensal')
    expect(callsOf('section_blueprint')).toHaveLength(0)
  })

  it('keeps going when the quota cannot be read', async () => {
    ai.prepare.mockResolvedValue(preparedWithQuota())
    usageRepo.sumSince.mockResolvedValue(err(databaseError()))
    const events = await collect(
      expectOk(
        await SiteAiService.generateSite(
          ACTOR,
          WS,
          brief({ inspirationImages: [IMAGE] }),
        ),
      ),
    )
    expect(events.at(-1)?.type).toBe('done')
    expect(callsOf('section_blueprint').length).toBeGreaterThan(0)
  })
})
