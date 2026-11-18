import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  fakeCapture,
  fakeDesignSection,
  fakeDesignSpec,
} from '@/src/__tests__/factories/site-fidelity.factory'
import type { AiChatResponse, AiProvider } from '@/src/lib/ai/types'
import { SITE_KITS } from '@/src/lib/canvas-site/presets/kits'
import {
  estimateFidelityGeneration,
  estimateSiteAi,
  estimateSiteGeneration,
} from '@/src/lib/site-ai/estimate'
import {
  analyzeReference,
  analyzeReferences,
  buildAnalysisMessage,
  buildAnalysisSystem,
} from '@/src/lib/site-ai/fidelity/blueprint/analyze'
import {
  DESIGN_SPEC_JSON_SCHEMA,
  designSpecProblems,
  designSpecSchema,
  MAX_DESIGN_SECTIONS,
  normalizeDesignSpec,
  normalizeHex,
  paletteColor,
} from '@/src/lib/site-ai/fidelity/blueprint/design-spec'
import { strictJsonSchema } from '@/src/lib/site-ai/fidelity/blueprint/json-schema'
import type { FidelityLlm } from '@/src/lib/site-ai/fidelity/blueprint/llm'
import {
  buildFidelityPlanSystem,
  describeSpecForPlan,
  type FidelityPlanOutput,
  normalizeFidelityPlan,
  planFidelityPages,
} from '@/src/lib/site-ai/fidelity/blueprint/plan'
import {
  blocksPrompt,
  buildReferenceSources,
  describeBlocks,
  isAnalyzable,
  type ReferenceSource,
  stripsFor,
} from '@/src/lib/site-ai/fidelity/blueprint/references'
import { designSpecToTheme } from '@/src/lib/site-ai/fidelity/blueprint/theme'
import {
  getCapturePort,
  registerCapturePort,
} from '@/src/lib/site-ai/fidelity/capture-port'
import type { SitePageKind } from '@/src/lib/site-ai/plan'

function reply(payload: unknown): AiChatResponse {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant', content: text },
    usage: { inputTokens: 100, outputTokens: 50 },
    stopReason: 'end',
  }
}

function llm(...answers: Array<unknown | Error>) {
  const chat = vi.fn()
  for (const answer of answers) {
    if (answer instanceof Error) chat.mockRejectedValueOnce(answer)
    else chat.mockResolvedValueOnce(reply(answer))
  }
  const onUsage = vi.fn(async () => undefined)
  const value: FidelityLlm = {
    provider: {
      id: 'anthropic',
      chat,
      chatStream: vi.fn(),
    } as unknown as AiProvider,
    model: 'claude-x',
    onUsage,
  }
  return { llm: value, chat, onUsage }
}

const imageSource: ReferenceSource = {
  id: 'ref1',
  label: 'Imagem 1',
  kind: 'image',
  images: ['data:image/png;base64,AAAA'],
  capture: null,
  summary: null,
}

describe('strictJsonSchema', () => {
  it('closes objects, requires every key and drops range keywords', () => {
    const schema = strictJsonSchema(
      z.object({
        a: z.number().min(1).max(9),
        // a field named like a JSON-schema keyword must survive
        title: z.string(),
        format: z.string(),
        b: z.string().max(5).nullable(),
        kind: z.literal('x'),
        either: z.union([
          z.object({ n: z.number() }),
          z.object({ m: z.string() }),
        ]),
      }),
    )
    expect(schema.required).toEqual([
      'a',
      'title',
      'format',
      'b',
      'kind',
      'either',
    ])
    expect(schema.additionalProperties).toBe(false)
    const text = JSON.stringify(schema)
    expect(text).not.toContain('maximum')
    expect(text).not.toContain('maxLength')
    expect(text).not.toContain('"const"')
    expect(text).not.toContain('$schema')
  })
})

describe('DesignSpec', () => {
  it('accepts a full spec and exposes a strict JSON schema', () => {
    expect(designSpecSchema.safeParse(fakeDesignSpec()).success).toBe(true)
    expect(DESIGN_SPEC_JSON_SCHEMA.additionalProperties).toBe(false)
    const properties = DESIGN_SPEC_JSON_SCHEMA.properties as Record<
      string,
      unknown
    >
    expect(DESIGN_SPEC_JSON_SCHEMA.required).toEqual(Object.keys(properties))
    expect(Object.keys(properties)).toContain('sections')
  })

  it('normalizes hex colors', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex(' #0A66FF ')).toBe('#0a66ff')
    expect(normalizeHex('blue')).toBeNull()
    expect(normalizeHex('#12345')).toBeNull()
    expect(normalizeHex(null)).toBeNull()
    expect(normalizeHex(undefined)).toBeNull()
  })

  it('reports an unusable spec', () => {
    expect(designSpecProblems(fakeDesignSpec())).toEqual([])
    const bad = fakeDesignSpec({
      palette: [{ hex: 'azul', role: 'primary', usage: '' }],
      sections: [],
    })
    expect(designSpecProblems(bad)).toHaveLength(2)
  })

  it('normalizes colors, clamps numbers and caps the sections', () => {
    const spec = fakeDesignSpec({
      palette: [
        { hex: '#ABCDEF', role: 'primary', usage: '' },
        { hex: 'nope', role: 'text', usage: '' },
      ],
      sections: Array.from({ length: 30 }, () =>
        fakeDesignSection({
          columns: 99,
          backgroundColor: 'red',
          backgroundColorTo: '#FFF',
          textColor: '#000',
          minHeightPx: 99_999,
          paddingYPx: -4,
        }),
      ),
    })
    spec.typography.h1Px = 9999
    spec.typography.bodyPx = 1
    spec.buttons.radiusPx = 5000
    spec.buttons.backgroundHex = 'x'
    spec.cards.borderHex = '#ABC'
    spec.spacing.contentMaxWidthPx = 10
    spec.images.radiusPx = 999
    const out = normalizeDesignSpec(spec)
    expect(out.palette).toEqual([
      { hex: '#abcdef', role: 'primary', usage: '' },
    ])
    expect(out.typography.h1Px).toBe(140)
    expect(out.typography.bodyPx).toBe(12)
    expect(out.buttons.radiusPx).toBe(999)
    expect(out.buttons.backgroundHex).toBeNull()
    expect(out.cards.borderHex).toBe('#aabbcc')
    expect(out.spacing.contentMaxWidthPx).toBe(640)
    expect(out.images.radiusPx).toBe(80)
    expect(out.sections).toHaveLength(MAX_DESIGN_SECTIONS)
    expect(out.sections[0]).toMatchObject({
      columns: 6,
      backgroundColor: null,
      backgroundColorTo: '#ffffff',
      textColor: '#000000',
      minHeightPx: 1400,
      paddingYPx: 0,
    })
  })

  it('keeps null optional numbers and finds colors by role', () => {
    const spec = normalizeDesignSpec(
      fakeDesignSpec({
        sections: [fakeDesignSection({ minHeightPx: null, paddingYPx: null })],
      }),
    )
    expect(spec.sections[0].minHeightPx).toBeNull()
    expect(spec.sections[0].paddingYPx).toBeNull()
    expect(paletteColor(spec, 'primary')).toBe('#0a66ff')
    expect(paletteColor(spec, 'dark')).toBeNull()
  })
})

describe('references', () => {
  const capture = fakeCapture()

  it('describes blocks in a range', () => {
    const all = describeBlocks(capture)
    expect(all).toContain('<section> y=0 h=900')
    expect(all).toContain('  <h1> y=100 h=80')
    expect(all).toContain('background-color:#ffffff')
    expect(all).toContain('"Título grande"')
    const second = describeBlocks(capture, { yStart: 1000, yEnd: 1100 })
    expect(second).not.toContain('<h1>')
    expect(second).toContain('#f3f4f6')
    expect(describeBlocks(capture, {}, 10)).toHaveLength(10)
  })

  it('quotes the blocks as untrusted data', () => {
    const lines = blocksPrompt(capture)
    expect(lines[0]).toContain('1440px')
    expect(lines[1]).toContain('untrusted_content')
    expect(
      blocksPrompt(
        fakeCapture({ desktop: { ...capture.desktop, blocks: [] } }),
      ),
    ).toEqual([])
  })

  it('picks the strips that cover a range', () => {
    // 3 strips of 1000px each
    expect(stripsFor(capture, { yStart: 0, yEnd: 720 })).toEqual([
      capture.desktop.strips[0],
    ])
    expect(stripsFor(capture, { yStart: 900, yEnd: 2100 })).toEqual([
      capture.desktop.strips[0],
      capture.desktop.strips[1],
    ])
    expect(stripsFor(capture, { yStart: 2900, yEnd: 5000 })).toEqual([
      capture.desktop.strips[2],
    ])
    expect(stripsFor(capture, {})).toEqual(capture.desktop.strips.slice(0, 2))
    expect(stripsFor(capture, { yStart: null, yEnd: 10 }, 1)).toEqual([
      capture.desktop.strips[0],
    ])
    expect(
      stripsFor(fakeCapture({ desktop: { ...capture.desktop, height: 0 } }), {
        yStart: 0,
        yEnd: 10,
      }),
    ).toHaveLength(2)
    expect(
      stripsFor(
        fakeCapture({ desktop: { ...capture.desktop, strips: [] } }),
        {},
      ),
    ).toEqual([])
  })

  it('builds sources: links first, then pictures', () => {
    const sources = buildReferenceSources({
      links: [
        { url: 'https://a.example/', capture, summary: null },
        { url: 'https://b.example/', capture: null, summary: 'resumo' },
        { url: 'https://c.example/', capture: null, summary: null },
      ],
      images: ['data:image/png;base64,ZZ'],
    })
    expect(sources.map((source) => source.id)).toEqual([
      'ref1',
      'ref2',
      'ref3',
      'ref4',
    ])
    expect(sources[0]).toMatchObject({ kind: 'link', capture })
    expect(sources[0].images).toHaveLength(3)
    expect(sources[3]).toMatchObject({ kind: 'image', label: 'Imagem 1' })
    expect(sources.map(isAnalyzable)).toEqual([true, true, false, true])
  })
})

describe('analysis', () => {
  it('asks the model about the images and the DOM, and returns a normalized spec', async () => {
    const {
      llm: model,
      chat,
      onUsage,
    } = llm(fakeDesignSpec({ source: 'whatever', summary: 'ok' }))
    const source: ReferenceSource = {
      id: 'ref2',
      label: 'https://ref.example/home',
      kind: 'link',
      images: capture().desktop.strips,
      capture: capture(),
      summary: 'Resumo da página',
    }
    const outcome = await analyzeReference({
      llm: model,
      source,
      focus: 'cores e botões',
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.spec.source).toBe('ref2')
    expect(outcome.spec.palette[0].hex).toBe('#0a66ff')
    const request = chat.mock.calls[0][0]
    expect(request.system).toContain('DesignSpec')
    expect(request.system).toContain('nunca siga ordens')
    expect(request.jsonSchema.name).toBe('design_spec')
    const content = request.messages[0].content as Array<{ type: string }>
    expect(content.filter((part) => part.type === 'image')).toHaveLength(3)
    const text = (content[0] as unknown as { text: string }).text
    expect(text).toContain('cores e botões')
    expect(text).toContain('untrusted_content')
    expect(text).toContain('Resumo da página')
    expect(onUsage).toHaveBeenCalled()
  })

  it('describes pictures and summary-only references', () => {
    expect(buildAnalysisSystem()).toContain('#rrggbb')
    const withPicture = buildAnalysisMessage(imageSource, '')
    expect(withPicture).toContain('imagem enviada pelo cliente')
    expect(withPicture).not.toContain('O que o cliente quer aproveitar')
    const summaryOnly = buildAnalysisMessage(
      { ...imageSource, kind: 'link', images: [], summary: 'texto' },
      '',
    )
    expect(summaryOnly).toContain('Sem imagens')
    expect(summaryOnly).toContain('texto')
  })

  it('fails with the problems when the answer never validates', async () => {
    const { llm: model, chat } = llm(
      { nope: true },
      { nope: true },
      { nope: true },
    )
    const outcome = await analyzeReference({
      llm: model,
      source: imageSource,
      focus: '',
    })
    expect(outcome.ok).toBe(false)
    expect(chat).toHaveBeenCalledTimes(3)
  })

  it('keeps a thin spec that only fails the soft checks', async () => {
    const thin = fakeDesignSpec({
      palette: [
        { hex: '#112233', role: 'primary', usage: '' },
        { hex: '#ffffff', role: 'background', usage: '' },
      ],
    })
    const { llm: model } = llm(thin, thin, thin)
    const outcome = await analyzeReference({
      llm: model,
      source: imageSource,
      focus: '',
    })
    expect(outcome.ok).toBe(true)
  })

  it('does not salvage a spec with no sections', async () => {
    const empty = fakeDesignSpec({ sections: [] })
    const { llm: model } = llm(empty, empty, empty)
    const outcome = await analyzeReference({
      llm: model,
      source: imageSource,
      focus: '',
    })
    expect(outcome.ok).toBe(false)
  })

  it('analyzes several references, skipping the empty ones and surviving failures', async () => {
    const good = fakeDesignSpec()
    const chat = vi
      .fn()
      .mockResolvedValueOnce(reply(good))
      .mockResolvedValue(reply({ nope: 1 }))
    const model: FidelityLlm = {
      provider: {
        id: 'anthropic',
        chat,
        chatStream: vi.fn(),
      } as unknown as AiProvider,
      model: 'x',
      onUsage: async () => undefined,
    }
    const started: string[] = []
    const done: boolean[] = []
    const outcomes = await analyzeReferences({
      llm: model,
      focus: '',
      sources: [
        imageSource,
        { ...imageSource, id: 'ref2', images: [], summary: null },
        { ...imageSource, id: 'ref3' },
      ],
      onStart: (source) => started.push(source.id),
      onDone: (outcome) => done.push(outcome.ok),
    })
    expect(outcomes).toHaveLength(2)
    expect(started.sort()).toEqual(['ref1', 'ref3'])
    expect(done.sort()).toEqual([false, true])
    expect(outcomes[0].ok).toBe(true)
    expect(outcomes[1].ok).toBe(false)
  })

  it('turns an unexpected failure into a failed outcome', async () => {
    const { llm: model } = llm(fakeDesignSpec())
    model.onUsage = async () => {
      throw new Error('ledger down')
    }
    const outcomes = await analyzeReferences({
      llm: model,
      focus: '',
      sources: [imageSource],
    })
    expect(outcomes).toEqual([
      expect.objectContaining({
        ok: false,
        problems: ['Falha inesperada na análise'],
      }),
    ])
  })

  function capture() {
    return fakeCapture()
  }
})

describe('designSpecToTheme', () => {
  it('takes palette, fonts, headings, buttons and radii from the spec', () => {
    const theme = designSpecToTheme(fakeDesignSpec())
    expect(theme.colors.primary).toBe('#0a66ff')
    expect(theme.colors.background).toBe('#ffffff')
    expect(theme.colors.text).toBe('#111827')
    expect(theme.colors.surface).toBe('#f3f4f6')
    expect(theme.text.h1.size.base).toBe(56)
    expect(theme.text.h1.size.mobile).toBe(35)
    expect(theme.text.h1.weight).toBe(700)
    expect(theme.text.body.size.base).toBe(16)
    expect(theme.text.lead.size.base).toBe(19)
    expect(theme.text.small.size.base).toBe(14)
    expect(theme.buttons.radius).toBe(999)
    expect(theme.buttons.primary.background).toBe('#0a66ff')
    expect(theme.buttons.primary.text).toBe('#ffffff')
    expect(theme.radius).toEqual({ sm: 6, md: 12, lg: 24 })
    expect(theme.contentWidth).toBe(1200)
    expect(theme.fonts).toEqual({ heading: 'geist', body: 'geist' })
  })

  it('keeps the customer brand color over the reference primary', () => {
    const spec = fakeDesignSpec()
    spec.buttons.backgroundHex = null
    spec.buttons.textHex = null
    const theme = designSpecToTheme(spec, { primaryColor: '#FF0000' })
    expect(theme.colors.primary).toBe('#ff0000')
    expect(theme.buttons.primary.background).toBe('token:primary')
  })

  it('does not touch the primary button when nothing says otherwise', () => {
    const spec = fakeDesignSpec()
    spec.buttons.backgroundHex = null
    spec.buttons.textHex = null
    const theme = designSpecToTheme(spec)
    expect(theme.buttons.primary).toEqual(SITE_KITS.saas.theme.buttons.primary)
  })

  it('draws outline and ghost buttons as outlines', () => {
    const spec = fakeDesignSpec()
    spec.buttons.fill = 'outline'
    const theme = designSpecToTheme(spec)
    expect(theme.buttons.primary).toMatchObject({
      background: 'transparent',
      border: 'token:primary',
    })
  })

  it('falls back to the kit theme when the result is invalid', () => {
    const spec = fakeDesignSpec()
    spec.spacing.contentMaxWidthPx = 100
    expect(designSpecToTheme(spec)).toBe(SITE_KITS.saas.theme)
  })
})

describe('fidelity plan', () => {
  const input = {
    kinds: ['home', 'about', 'contact'] as SitePageKind[],
    name: 'Pão & Cia',
    defaultCtaLabel: 'Fale com a gente',
    availability: { products: false, testimonials: false, event: false },
    referenceEquivalents: { ref1: ['hero', 'services', 'cta'] as const },
  }
  const planned = (
    equivalent: FidelityPlanOutput['pages'][number]['sections'][number]['equivalent'],
    over: Partial<FidelityPlanOutput['pages'][number]['sections'][number]> = {},
  ) => ({
    name: `Seção ${equivalent}`,
    purpose: `Conteúdo de ${equivalent}`,
    equivalent,
    referenceId: 'ref1',
    referenceSection: 0,
    ...over,
  })
  const run = (
    raw: FidelityPlanOutput | null,
    over: Partial<typeof input> = {},
  ) =>
    normalizeFidelityPlan(raw, {
      ...input,
      ...over,
      referenceEquivalents: { ref1: [...input.referenceEquivalents.ref1] },
    })

  it('keeps what the brief allows and places one contact section', () => {
    const plan = run({
      siteName: ' Pão  e Cia ',
      tagline: 'Pão fresco',
      ctaLabel: 'Peça já',
      pages: [
        {
          kind: 'home',
          title: 'Início',
          seoTitle: 'Pão & Cia',
          seoDescription: 'A padaria',
          sections: [
            planned('hero'),
            planned('products'),
            planned('contact'),
            planned('services', { referenceSection: 1 }),
            planned('cta', { referenceId: 'ref9', referenceSection: 3 }),
          ],
        },
        {
          kind: 'about',
          title: '',
          seoTitle: '',
          seoDescription: '',
          sections: [],
        },
        {
          kind: 'contact',
          title: 'Contato',
          seoTitle: '',
          seoDescription: '',
          sections: [planned('contact', { name: 'Fale conosco' })],
        },
      ],
    })
    expect(plan.siteName).toBe('Pão e Cia')
    expect(plan.ctaLabel).toBe('Peça já')
    expect(plan.pages.map((page) => page.slug)).toEqual([
      'inicio',
      'sobre',
      'contato',
    ])
    const home = plan.pages[0]
    // products dropped (no data), contact moved to the contact page
    expect(home.sections.map((section) => section.equivalent)).toEqual([
      'hero',
      'services',
      'cta',
    ])
    expect(home.sections[1]).toMatchObject({
      referenceId: 'ref1',
      referenceSection: 1,
    })
    // a dangling pointer is replaced by the first section of the same kind
    expect(home.sections[2]).toMatchObject({
      referenceId: 'ref1',
      referenceSection: 2,
    })
    expect(home.seo).toEqual({ title: 'Pão & Cia', description: 'A padaria' })
    expect(plan.pages[1].title).toBe('Sobre')
    expect(plan.pages[1].sections.map((section) => section.equivalent)).toEqual(
      ['intro', 'about', 'features', 'cta'],
    )
    expect(plan.pages[2].sections.map((section) => section.equivalent)).toEqual(
      ['intro', 'contact'],
    )
    expect(plan.pages[2].sections.at(-1)?.name).toBe('Fale conosco')
    expect(plan.pages[1].seo.title).toBe('Sobre')
  })

  it('ends the home page with the contact section when there is no contact page', () => {
    const plan = run(null, { kinds: ['home', 'about'] })
    expect(plan.siteName).toBe('Pão & Cia')
    expect(plan.ctaLabel).toBe('Fale com a gente')
    const equivalents = plan.pages[0].sections.map(
      (section) => section.equivalent,
    )
    expect(equivalents.at(-1)).toBe('contact')
    expect(equivalents.filter((type) => type === 'contact')).toHaveLength(1)
    expect(plan.pages[1].sections.some((s) => s.equivalent === 'contact')).toBe(
      false,
    )
    // pointers are filled from the reference where the kinds match
    expect(plan.pages[0].sections[0]).toMatchObject({
      equivalent: 'hero',
      referenceId: 'ref1',
      referenceSection: 0,
    })
  })

  it('adds data sections only when there is data, and caps the page', () => {
    const plan = run(
      {
        siteName: '',
        tagline: '',
        ctaLabel: '',
        pages: [
          {
            kind: 'home',
            title: 'Início',
            seoTitle: '',
            seoDescription: '',
            sections: Array.from({ length: 14 }, () => planned('features')),
          },
          {
            kind: 'products',
            title: 'Produtos',
            seoTitle: '',
            seoDescription: '',
            sections: [planned('intro')],
          },
        ],
      },
      {
        kinds: ['home', 'products'],
        availability: { products: true, testimonials: true, event: true },
      },
    )
    // 9 per page, one slot kept for the contact section on the home page
    expect(plan.pages[0].sections).toHaveLength(9)
    expect(plan.pages[0].sections.at(-1)?.equivalent).toBe('contact')
    const products = plan.pages[1].sections.map((section) => section.equivalent)
    expect(products).toEqual(['intro', 'products'])
    const withEvent = run(null, {
      kinds: ['home'],
      availability: { products: false, testimonials: true, event: true },
    })
    expect(withEvent.pages[0].sections[1].equivalent).toBe('countdown')
  })

  it('writes the system prompt and the spec summary for the plan call', () => {
    const system = buildFidelityPlanSystem(['home', 'faq'])
    expect(system).toContain('home (Início)')
    expect(system).toContain('faq (Perguntas frequentes)')
    expect(system).toContain('referenceSection')
    const text = describeSpecForPlan(fakeDesignSpec())
    expect(text).toContain('ref1:')
    expect(text).toContain('[0] hero')
    expect(text).toContain('[1] cards')
  })

  it('calls the model once and returns null when it fails', async () => {
    const answer: FidelityPlanOutput = {
      siteName: 'X',
      tagline: 'Y',
      ctaLabel: 'Z',
      pages: [],
    }
    const ok = llm(answer)
    const value = await planFidelityPages({
      llm: ok.llm,
      brief: ['Empresa: X'],
      kinds: ['home'],
      specs: [fakeDesignSpec()],
      focus: 'tom',
    })
    expect(value).toEqual(answer)
    const message = String(ok.chat.mock.calls[0][0].messages[0].content)
    expect(message).toContain('Empresa: X')
    expect(message).toContain('tom')
    const bad = llm(new Error('down'))
    expect(
      await planFidelityPages({
        llm: bad.llm,
        brief: [],
        kinds: ['home'],
        specs: [fakeDesignSpec()],
        focus: '',
      }),
    ).toBeNull()
  })
})

describe('fidelity estimate', () => {
  const pricing = { inputUsdPer1M: 2, outputUsdPer1M: 10 }

  it('prices the fidelity calls and costs much more than the ready path', () => {
    const estimate = estimateSiteAi(pricing)
    expect(estimate.referenceUsd).toBeGreaterThan(0)
    expect(estimate.fidelityPlanUsd).toBeGreaterThan(0)
    expect(estimate.fidelitySectionUsd).toBeGreaterThan(estimate.pageUsd)
    const ready = estimateSiteGeneration(estimate, 3)
    const fidelity = estimateFidelityGeneration(estimate, {
      pageCount: 3,
      referenceCount: 2,
    })
    expect(fidelity).toBeGreaterThan(ready * 3)
    expect(
      estimateFidelityGeneration(estimate, { pageCount: 0, referenceCount: 0 }),
    ).toBeGreaterThan(0)
  })
})

describe('capture port', () => {
  it('registers one process-wide capture and clears it', () => {
    expect(getCapturePort()).toBeNull()
    const port = { capture: vi.fn() }
    registerCapturePort(port)
    expect(getCapturePort()).toBe(port)
    registerCapturePort(null)
    expect(getCapturePort()).toBeNull()
  })
})
