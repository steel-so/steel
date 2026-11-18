import { describe, expect, it, vi } from 'vitest'
import {
  bpButton,
  bpForm,
  bpSection,
  bpText,
  fakeCapture,
  fakeDesignSpec,
  fakeHeroBlueprint,
} from '@/src/__tests__/factories/site-fidelity.factory'
import type { AiChatResponse, AiProvider } from '@/src/lib/ai/types'
import { section } from '@/src/lib/canvas-site/presets/builder'
import { SITE_KITS } from '@/src/lib/canvas-site/presets/kits'
import { blueprintToNodeSpec } from '@/src/lib/site-ai/fidelity/blueprint/compile'
import {
  brandColorMap,
  buildBlueprintMessage,
  buildBlueprintSystem,
  buildFidelitySection,
  describeTokens,
  generateSectionBlueprint,
  remapBlueprintColors,
  type SectionRequest,
  sectionImages,
} from '@/src/lib/site-ai/fidelity/blueprint/generate'
import type { FidelityLlm } from '@/src/lib/site-ai/fidelity/blueprint/llm'
import {
  fidelityPageDocument,
  pickReadySlots,
  sectionOfNodes,
} from '@/src/lib/site-ai/fidelity/blueprint/page'
import {
  FIDELITY_BUDGET_MS,
  type FidelityProgress,
  runFidelityPipeline,
} from '@/src/lib/site-ai/fidelity/blueprint/pipeline'
import type { PlannedSection } from '@/src/lib/site-ai/fidelity/blueprint/plan'
import type { ReferenceSource } from '@/src/lib/site-ai/fidelity/blueprint/references'
import { buildSection, type SectionContext } from '@/src/lib/site-ai/sections'
import { collectSlots } from '@/src/lib/site-ai/slots'
import { validateSiteDocument } from '@/src/lib/sites/document'

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

function llm(handler: (n: number) => unknown | Promise<unknown>) {
  let calls = 0
  const chat = vi.fn(async () => {
    const answer = await handler(calls++)
    if (answer instanceof Error) throw answer
    return reply(answer)
  })
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

function context(overrides: Partial<SectionContext> = {}): SectionContext {
  return {
    kit: SITE_KITS.saas,
    companyName: 'Padaria Pão & Cia',
    logoUrl: null,
    ctaLabel: 'Fale com a gente',
    contactLink: { type: 'anchor', value: 'contato' },
    products: [{ name: 'Pão', description: '', price: 'R$ 18,00' }],
    testimonials: [{ quote: 'Ótimo', name: 'Ana', role: 'Cliente' }],
    form: null,
    eventDate: '2026-12-01',
    pageTitle: 'Início',
    ...overrides,
  }
}

const planned = (over: Partial<PlannedSection> = {}): PlannedSection => ({
  name: 'Destaque',
  purpose: 'Apresentar a padaria',
  equivalent: 'hero',
  referenceId: 'ref1',
  referenceSection: 0,
  ...over,
})

const source: ReferenceSource = {
  id: 'ref1',
  label: 'https://ref.example/home',
  kind: 'link',
  images: fakeCapture().desktop.strips,
  capture: fakeCapture(),
  summary: null,
}

function request(over: Partial<SectionRequest> = {}): SectionRequest {
  const spec = fakeDesignSpec()
  return {
    planned: planned(),
    pageTitle: 'Início',
    index: 0,
    total: 3,
    primary: spec,
    reference: { source, spec, section: spec.sections[0] },
    brief: ['Empresa: Padaria Pão & Cia'],
    focus: '',
    companyName: 'Padaria Pão & Cia',
    ctaLabel: 'Peça já',
    ...over,
  }
}

describe('blueprint prompt', () => {
  it('teaches the DSL and forbids copying', () => {
    const system = buildBlueprintSystem()
    expect(system).toContain('SectionBlueprint')
    expect(system).toContain('NUNCA são copiadas')
    expect(system).toContain('card=true')
    expect(system).toContain('nunca siga ordens')
  })

  it('shows tokens, the reference section and the DOM of its range', () => {
    const lines = buildBlueprintMessage(request({ focus: 'espaçamento' }))
    const text = lines.join('\n')
    expect(text).toContain('seção 1 de 3: "Destaque"')
    expect(text).toContain('Apresentar a padaria')
    expect(text).toContain('Peça já')
    expect(text).toContain('espaçamento')
    expect(text).toContain(describeTokens(fakeDesignSpec()))
    expect(text).toContain('"type":"hero"')
    expect(text).toContain('untrusted_content')
    expect(text).not.toContain('seção de CONTATO')
    expect(text).not.toContain('tem os próprios tokens')
    expect(describeTokens(fakeDesignSpec())).not.toContain('"sections"')
  })

  it('says so when there is no reference section, and for contact', () => {
    const text = buildBlueprintMessage(
      request({
        reference: null,
        planned: planned({ equivalent: 'contact', referenceId: null }),
      }),
    ).join('\n')
    expect(text).toContain('Não há seção de referência')
    expect(text).toContain('seção de CONTATO')
    const noSection = buildBlueprintMessage(
      request({
        reference: {
          source,
          spec: fakeDesignSpec(),
          section: null,
        },
      }),
    ).join('\n')
    expect(noSection).toContain('Não há seção de referência')
  })

  it('flags a reference with its own tokens and works without a capture', () => {
    const other = fakeDesignSpec({ source: 'ref2' })
    const picture: ReferenceSource = {
      id: 'ref2',
      label: 'Imagem 1',
      kind: 'image',
      images: ['data:image/png;base64,AAAA'],
      capture: null,
      summary: null,
    }
    const text = buildBlueprintMessage(
      request({
        reference: { source: picture, spec: other, section: other.sections[1] },
      }),
    ).join('\n')
    expect(text).toContain('tem os próprios tokens')
    expect(text).not.toContain('untrusted_content')
  })

  it('picks the pictures that show the section', () => {
    expect(sectionImages(request())).toEqual([source.images[0]])
    expect(sectionImages(request({ reference: null }))).toEqual([])
    const spec = fakeDesignSpec({ source: 'ref2' })
    const picture: ReferenceSource = {
      id: 'ref2',
      label: 'Imagem 1',
      kind: 'image',
      images: ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'],
      capture: null,
      summary: null,
    }
    expect(
      sectionImages(
        request({
          reference: { source: picture, spec, section: spec.sections[0] },
        }),
      ),
    ).toEqual(['data:image/png;base64,AAAA'])
  })
})

describe('brand color', () => {
  it('swaps the reference primary for the customer brand color', () => {
    const map = brandColorMap(fakeDesignSpec(), '#FF0000')
    expect(map).toEqual({ '#0a66ff': '#ff0000' })
    const blueprint = bpSection([
      bpButton({ bg: '#0A66FF', textColor: '#ffffff' }),
    ])
    const out = remapBlueprintColors(blueprint, map)
    const button = out.children[0] as { bg: string; textColor: string }
    expect(button.bg).toBe('#ff0000')
    expect(button.textColor).toBe('#ffffff')
    expect(remapBlueprintColors(blueprint, {})).toBe(blueprint)
  })

  it('does nothing without a brand color or when it is the same', () => {
    expect(brandColorMap(fakeDesignSpec(), null)).toEqual({})
    expect(brandColorMap(fakeDesignSpec(), 'nope')).toEqual({})
    expect(brandColorMap(fakeDesignSpec(), '#0a66ff')).toEqual({})
    expect(brandColorMap(fakeDesignSpec({ palette: [] }), '#ff0000')).toEqual(
      {},
    )
  })
})

describe('generateSectionBlueprint', () => {
  const ctx = { contactLink: { type: 'anchor' as const, value: 'contato' } }

  it('draws, remaps the brand color, compiles and validates', async () => {
    const answer = bpSection([bpButton({ bg: '#0a66ff' }), bpText()])
    const { llm: model, chat, onUsage } = llm(() => answer)
    const result = await generateSectionBlueprint({
      llm: model,
      request: request(),
      ctx,
      brandColor: '#ff0000',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.name).toBe('Destaque')
    expect(result.spec.children?.[0].props.background).toBe('#ff0000')
    expect(result.blueprint.children).toHaveLength(2)
    expect(chat).toHaveBeenCalledTimes(1)
    expect(onUsage).toHaveBeenCalledTimes(1)
  })

  it('repairs, and gives up with the problems', async () => {
    const { llm: model, chat } = llm(() => bpSection([]))
    const result = await generateSectionBlueprint({
      llm: model,
      request: request(),
      ctx,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.join(' ')).toContain('vazia')
    expect(chat).toHaveBeenCalledTimes(3)
  })

  it('requires the form in the contact section and refuses it elsewhere', async () => {
    const contact = request({
      planned: planned({ equivalent: 'contact' }),
    })
    const missing = await generateSectionBlueprint({
      llm: llm(() => bpSection([bpText()])).llm,
      request: contact,
      ctx,
    })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.problems.join(' ')).toContain('form')

    const withForm = await generateSectionBlueprint({
      llm: llm(() => bpSection([bpText(), bpForm()])).llm,
      request: contact,
      ctx,
    })
    expect(withForm.ok).toBe(true)

    const stray = await generateSectionBlueprint({
      llm: llm(() => bpSection([bpText(), bpForm()])).llm,
      request: request(),
      ctx,
    })
    expect(stray.ok).toBe(false)
    if (!stray.ok) expect(stray.problems.join(' ')).toContain('form')
  })

  it('fails softly on timeout and on unexpected errors', async () => {
    const hang = llm(() => new Promise(() => undefined))
    const slow = await generateSectionBlueprint({
      llm: hang.llm,
      request: request(),
      ctx,
      timeoutMs: 5,
    })
    expect(slow).toEqual({
      ok: false,
      problems: ['A IA demorou demais para desenhar a seção'],
    })

    const broken = llm(() => bpSection([bpText()]))
    broken.llm.onUsage = async () => {
      throw new Error('ledger down')
    }
    const failed = await generateSectionBlueprint({
      llm: broken.llm,
      request: request(),
      ctx,
    })
    expect(failed).toEqual({
      ok: false,
      problems: ['Falha inesperada ao desenhar a seção'],
    })

    const down = llm(() => new Error('provider down'))
    const unavailable = await generateSectionBlueprint({
      llm: down.llm,
      request: request(),
      ctx,
    })
    expect(unavailable.ok).toBe(false)
  })
})

describe('buildFidelitySection', () => {
  const sectionCtx = context()
  const drawn = {
    ok: true as const,
    spec: section({}, []),
    blueprint: bpSection([bpText()]),
  }

  it('uses ready sections for data without calling the model', async () => {
    const draw = vi.fn()
    for (const equivalent of [
      'products',
      'testimonials',
      'countdown',
    ] as const) {
      const built = await buildFidelitySection({
        llm: llm(() => null).llm,
        request: request({ planned: planned({ equivalent }) }),
        sectionCtx,
        draw,
      })
      expect(built.origin).toBe('ready')
      expect(built.warning).toBeNull()
    }
    expect(draw).not.toHaveBeenCalled()
  })

  it('goes straight to the ready section when drawing is skipped', async () => {
    const draw = vi.fn()
    const built = await buildFidelitySection({
      llm: llm(() => null).llm,
      request: request(),
      sectionCtx,
      skipDrawing: true,
      draw,
    })
    expect(built.origin).toBe('ready')
    expect(built.warning).toContain('limite de tempo ou de cota')
    expect(draw).not.toHaveBeenCalled()
  })

  it('falls back to the equivalent section when the drawing fails', async () => {
    const draw = vi.fn(async () => ({ ok: false as const, problems: ['x'] }))
    const built = await buildFidelitySection({
      llm: llm(() => null).llm,
      request: request(),
      sectionCtx,
      draw,
    })
    expect(built.origin).toBe('ready')
    expect(built.warning).toContain('"Destaque"')
    expect(built.warning).toContain('modelo pronto')
    expect(built.spec.type).toBe(buildSection('hero', sectionCtx).type)
  })

  it('keeps the drawn section and anchors the contact one', async () => {
    const draw = vi.fn(async () => drawn)
    const built = await buildFidelitySection({
      llm: llm(() => null).llm,
      request: request({ planned: planned({ equivalent: 'contact' }) }),
      sectionCtx,
      brandColor: '#ff0000',
      timeoutMs: 1234,
      draw,
    })
    expect(built).toEqual({
      spec: drawn.spec,
      origin: 'blueprint',
      warning: null,
    })
    expect(draw).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: { contactLink: sectionCtx.contactLink, sectionAnchor: 'contato' },
        brandColor: '#ff0000',
        timeoutMs: 1234,
      }),
    )
    const other = await buildFidelitySection({
      llm: llm(() => null).llm,
      request: request(),
      sectionCtx,
      draw,
    })
    expect(other.origin).toBe('blueprint')
    expect(draw).toHaveBeenLastCalledWith(
      expect.objectContaining({ ctx: { contactLink: sectionCtx.contactLink } }),
    )
  })

  it('draws with the model by default', async () => {
    const { llm: model, chat } = llm(() => bpSection([bpText()]))
    const built = await buildFidelitySection({
      llm: model,
      request: request(),
      sectionCtx,
    })
    expect(built.origin).toBe('blueprint')
    expect(chat).toHaveBeenCalledTimes(1)
  })
})

describe('fidelity page documents', () => {
  it('lets only the ready sections have their copy rewritten', () => {
    const ctx = context()
    const drawn = blueprintToNodeSpec(fakeHeroBlueprint(), {
      contactLink: ctx.contactLink,
    })
    const ready = buildSection('services', ctx)
    const page = fidelityPageDocument({
      specs: [drawn, ready],
      origins: ['blueprint', 'ready'],
    })
    expect(validateSiteDocument(page.doc).ok).toBe(true)
    expect(page.readySectionIds.size).toBe(1)
    const slots = collectSlots(page.doc)
    const picked = pickReadySlots(page, slots)
    expect(picked.length).toBeGreaterThan(0)
    expect(picked.length).toBeLessThan(slots.length)
    const owner = sectionOfNodes(page.doc)
    const [readyId] = [...page.readySectionIds]
    for (const slot of picked) expect(owner.get(slot.nodeId)).toBe(readyId)
    const all = pickReadySlots({ ...page, readySectionIds: new Set() }, slots)
    expect(all).toEqual([])
  })
})

describe('runFidelityPipeline', () => {
  const analysisOf = (
    src: ReferenceSource,
    spec = fakeDesignSpec({ source: src.id }),
  ) => ({ ok: true as const, source: src, spec })
  const imageSource = (id: string): ReferenceSource => ({
    id,
    label: `Imagem ${id}`,
    kind: 'image',
    images: ['data:image/png;base64,AAAA'],
    capture: null,
    summary: null,
  })
  const rawPlan = {
    siteName: 'Pão & Cia',
    tagline: 'Pão fresco',
    ctaLabel: 'Peça já',
    pages: [
      {
        kind: 'home',
        title: 'Início',
        seoTitle: 'Pão & Cia',
        seoDescription: 'A padaria',
        sections: [
          {
            name: 'Destaque',
            purpose: 'Apresentar',
            equivalent: 'hero' as const,
            referenceId: 'ref1',
            referenceSection: 0,
          },
          {
            name: 'Serviços',
            purpose: 'O que fazemos',
            equivalent: 'services' as const,
            referenceId: 'ref1',
            referenceSection: 1,
          },
        ],
      },
    ],
  }

  function setup(over: Record<string, unknown> = {}) {
    const events: FidelityProgress[] = []
    const ref1 = imageSource('ref1')
    const build = vi.fn(async () => ({
      spec: section({}, []),
      origin: 'blueprint' as const,
      warning: null,
    }))
    const analyze = vi.fn(async () => [analysisOf(ref1)])
    const plan = vi.fn(async () => rawPlan)
    const sectionContext = vi.fn(() => context())
    const input = {
      llm: llm(() => null).llm,
      brief: ['Empresa: Pão & Cia'],
      focus: 'cores',
      kinds: ['home' as const],
      name: 'Pão & Cia',
      defaultCtaLabel: 'Fale com a gente',
      primaryColor: null,
      availability: { products: false, testimonials: false, event: false },
      sources: [ref1],
      sectionContext,
      onProgress: (event: FidelityProgress) => events.push(event),
      deps: { analyze, plan, build },
      ...over,
    } as unknown as Parameters<typeof runFidelityPipeline>[0]
    return { input, events, build, analyze, plan, sectionContext, ref1 }
  }

  it('analyzes, plans, themes and draws every section', async () => {
    const { input, events, build, sectionContext } = setup()
    const result = await runFidelityPipeline(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kit).toBe('saas')
    expect(result.theme.colors.primary).toBe('#0a66ff')
    expect(result.warnings).toEqual([])
    expect(result.plan.pages[0].sections.map((s) => s.equivalent)).toEqual([
      'hero',
      'services',
      'contact',
    ])
    const page = result.pages[0]
    expect(page.specs).toHaveLength(3)
    expect(page.origins).toEqual(['blueprint', 'blueprint', 'blueprint'])
    expect(page.equivalents).toEqual(['hero', 'services', 'contact'])
    expect(build).toHaveBeenCalledTimes(3)
    expect(sectionContext).toHaveBeenCalledTimes(1)
    const first = (
      build.mock.calls[0] as unknown as [
        { request: SectionRequest; skipDrawing: boolean },
      ]
    )[0]
    expect(first.request).toMatchObject({
      index: 0,
      total: 3,
      pageTitle: 'Início',
      ctaLabel: 'Peça já',
    })
    expect(first.request.reference?.section?.type).toBe('hero')
    expect(first.skipDrawing).toBe(false)
    const ids = events.map((event) => `${event.id}:${event.status}`)
    expect(ids.slice(0, 4)).toEqual([
      'analysis:running',
      'analysis:done',
      'theme:running',
      'theme:done',
    ])
    expect(ids.filter((id) => id === 'page:home:running')).toHaveLength(3)
    expect(ids.filter((id) => id === 'page:home:done')).toHaveLength(1)
    expect(events[1].label).toBe('Referências analisadas')
    expect(events.at(-1)?.label).toBe('Página Início pronta')
  })

  it('reports references that could not be analyzed and keeps going', async () => {
    const { input, events, analyze, ref1 } = setup()
    const ref2 = imageSource('ref2')
    analyze.mockResolvedValue([
      analysisOf(ref1),
      { ok: false as const, source: ref2, problems: ['x'] },
    ] as never)
    const result = await runFidelityPipeline({
      ...input,
      sources: [ref1, ref2],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.join(' ')).toContain('Imagem ref2')
    expect(events[1].label).toBe('1 de 2 referências analisadas')
  })

  it('stops when no reference could be analyzed', async () => {
    const { input, events, analyze, plan, ref1 } = setup()
    analyze.mockResolvedValue([
      { ok: false as const, source: ref1, problems: ['x'] },
    ] as never)
    const result = await runFidelityPipeline(input)
    expect(result).toMatchObject({ ok: false, reason: 'analysis_failed' })
    expect(events.at(-1)).toMatchObject({ id: 'analysis', status: 'failed' })
    expect(plan).not.toHaveBeenCalled()
  })

  it('refuses to run without sources', async () => {
    const { input, events, analyze } = setup({ sources: [] })
    expect(await runFidelityPipeline(input)).toEqual({
      ok: false,
      reason: 'no_reference',
      warnings: [],
    })
    expect(events).toEqual([])
    expect(analyze).not.toHaveBeenCalled()
  })

  it('uses default sections in the references style when the plan fails', async () => {
    const { input, plan } = setup()
    plan.mockResolvedValue(null as never)
    const result = await runFidelityPipeline(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.join(' ')).toContain('não montou o plano')
    expect(result.plan.pages[0].sections[0].equivalent).toBe('hero')
  })

  it('falls back to the ready section when a section build throws', async () => {
    const { input, build } = setup()
    build.mockRejectedValueOnce(new Error('boom'))
    const result = await runFidelityPipeline(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const page = result.pages[0]
    expect(page.origins[0]).toBe('ready')
    expect(page.origins[1]).toBe('blueprint')
    expect(page.specs[0].type).toBe(buildSection('hero', context()).type)
    expect(result.warnings.join(' ')).toContain('modelo pronto')
  })

  it('stops calling the model when the quota is spent, warning once', async () => {
    const { input, build } = setup({ overBudget: () => true })
    const result = await runFidelityPipeline(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const call of build.mock.calls) {
      expect(
        (call as unknown as [{ skipDrawing: boolean }])[0].skipDrawing,
      ).toBe(true)
    }
    expect(
      result.warnings.filter((warning) => warning.includes('cota mensal')),
    ).toHaveLength(1)
  })

  it('stops calling the model when the time budget is spent', async () => {
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(10_000)
    const { input, build } = setup({ budgetMs: 50 })
    input.deps = { ...input.deps, now }
    const result = await runFidelityPipeline(input)
    expect(result.ok).toBe(true)
    for (const call of build.mock.calls) {
      expect(
        (call as unknown as [{ skipDrawing: boolean }])[0].skipDrawing,
      ).toBe(true)
    }
    expect(FIDELITY_BUDGET_MS).toBeGreaterThan(60_000)
  })

  it('collects the warnings of the sections that fell back', async () => {
    const { input, build } = setup()
    build.mockResolvedValueOnce({
      spec: section({}, []),
      origin: 'ready' as never,
      warning: 'A seção "Destaque" usou o modelo pronto.',
    } as never)
    const result = await runFidelityPipeline(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([
      'A seção "Destaque" usou o modelo pronto.',
    ])
    expect(result.pages[0].warnings).toHaveLength(1)
  })
})
