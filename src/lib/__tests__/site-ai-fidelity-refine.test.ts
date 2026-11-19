import { describe, expect, it, vi } from 'vitest'
import {
  fakeCapture,
  fakeDesignSpec,
  fakeHeroBlueprint,
} from '@/src/__tests__/factories/site-fidelity.factory'
import { appError } from '@/src/errors/app-error'
import type { AiChatResponse, AiProvider } from '@/src/lib/ai/types'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { section, toDocument } from '@/src/lib/canvas-site/presets/builder'
import { SITE_KITS } from '@/src/lib/canvas-site/presets/kits'
import { err, ok } from '@/src/lib/result'
import type { FidelityResult } from '@/src/lib/site-ai/fidelity/blueprint'
import type { SectionRequest } from '@/src/lib/site-ai/fidelity/blueprint/generate'
import type { FidelityLlm } from '@/src/lib/site-ai/fidelity/blueprint/llm'
import type { PlannedSection } from '@/src/lib/site-ai/fidelity/blueprint/plan'
import type { ReferenceSource } from '@/src/lib/site-ai/fidelity/blueprint/references'
import { isInternalRequest } from '@/src/lib/site-ai/fidelity/capture/capture-reference'
import {
  buildCompareMessage,
  compareSection,
  differencesToInstructions,
} from '@/src/lib/site-ai/fidelity/refine/compare'
import { resolveRefineConfig } from '@/src/lib/site-ai/fidelity/refine/config'
import {
  createPreviewToken,
  previewPath,
  resolveInternalPreview,
  verifyPreviewToken,
} from '@/src/lib/site-ai/fidelity/refine/preview-token'
import {
  draftSectionRanges,
  pickStrips,
} from '@/src/lib/site-ai/fidelity/refine/ranges'
import {
  type RefineDraft,
  type RefineInput,
  type RefineTarget,
  refineDraft,
} from '@/src/lib/site-ai/fidelity/refine/refine'
import { createDraftRenderer } from '@/src/lib/site-ai/fidelity/refine/render'
import { swapSection } from '@/src/lib/site-ai/fidelity/refine/replace'
import { runRefinement } from '@/src/lib/site-ai/fidelity/refine/run'
import {
  buildRefineTargets,
  createSectionRecorder,
  type SectionRecord,
} from '@/src/lib/site-ai/fidelity/refine/targets'
import type { ReferenceCapture } from '@/src/lib/site-ai/fidelity/types'
import type { SectionContext } from '@/src/lib/site-ai/sections'

const SECRET = 'ba_test-secret-for-previews'

function reply(payload: unknown): AiChatResponse {
  const text = JSON.stringify(payload)
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant', content: text },
    usage: { inputTokens: 100, outputTokens: 50 },
    stopReason: 'end',
  }
}

function llm(handler: (n: number) => unknown) {
  let calls = 0
  const chat = vi.fn(async () => reply(handler(calls++)))
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

describe('preview token', () => {
  it('verifies a fresh token and rejects expired, forged and malformed ones', () => {
    const now = 1_800_000_000_000
    const { token, id } = createPreviewToken(SECRET, now, 60)
    expect(verifyPreviewToken(SECRET, token, now + 30_000)).toBe(id)
    expect(verifyPreviewToken(SECRET, token, now + 61_000)).toBeNull()
    expect(verifyPreviewToken('ba_another-secret-value', token, now)).toBeNull()
    const [tokenId, expires, signature] = token.split('.')
    expect(
      verifyPreviewToken(
        SECRET,
        `${tokenId}.${Number(expires) + 600}.${signature}`,
        now,
      ),
    ).toBeNull()
    expect(verifyPreviewToken(SECRET, 'nope', now)).toBeNull()
    expect(
      verifyPreviewToken(SECRET, `${tokenId}.${expires}.zz`, now),
    ).toBeNull()
  })

  it('maps a signed public preview URL to the internal origin', () => {
    const now = Date.now()
    const { token } = createPreviewToken(SECRET, now)
    const url = `https://app.example.com${previewPath(token, 2)}`
    const resolved = resolveInternalPreview(
      url,
      {
        publicOrigin: 'https://app.example.com',
        internalOrigin: 'http://nextjs-app:3000',
        secret: SECRET,
      },
      now,
    )
    expect(resolved).toEqual({
      url: `http://nextjs-app:3000/site-preview/${token}?p=2`,
      origin: 'http://nextjs-app:3000',
    })
  })

  it('refuses other hosts, other paths and bad signatures', () => {
    const now = Date.now()
    const { token } = createPreviewToken(SECRET, now)
    const input = {
      publicOrigin: 'https://app.example.com',
      internalOrigin: 'http://nextjs-app:3000',
      secret: SECRET,
    }
    expect(
      resolveInternalPreview(
        `https://evil.example${previewPath(token, 0)}`,
        input,
        now,
      ),
    ).toBeNull()
    expect(
      resolveInternalPreview(
        `https://app.example.com/api/admin?x=${token}`,
        input,
        now,
      ),
    ).toBeNull()
    expect(
      resolveInternalPreview(
        `https://app.example.com${previewPath(token, 0)}`,
        { ...input, secret: 'ba_other-secret-value-here' },
        now,
      ),
    ).toBeNull()
    expect(
      resolveInternalPreview(
        `https://app.example.com${previewPath(token, 0)}`,
        input,
        now + 3 * 60 * 60_000,
      ),
    ).toBeNull()
  })
})

describe('isInternalRequest', () => {
  it('allows only the exact internal origin outside the API', () => {
    const origin = 'http://nextjs-app:3000'
    expect(
      isInternalRequest('http://nextjs-app:3000/site-preview/x', origin),
    ).toBe(true)
    expect(
      isInternalRequest('http://nextjs-app:3000/_next/static/a.css', origin),
    ).toBe(true)
    expect(
      isInternalRequest('http://nextjs-app:3000/api/auth/session', origin),
    ).toBe(false)
    expect(isInternalRequest('http://other:3000/site-preview/x', origin)).toBe(
      false,
    )
    expect(
      isInternalRequest('http://nextjs-app:3000/site-preview/x', undefined),
    ).toBe(false)
    expect(isInternalRequest('not a url', origin)).toBe(false)
  })
})

describe('refine config', () => {
  it('uses the defaults and clamps what is out of range', () => {
    expect(resolveRefineConfig({})).toEqual({
      maxRounds: 3,
      targetScore: 85,
      budgetMs: 25 * 60_000,
    })
    expect(
      resolveRefineConfig({
        maxRounds: '2',
        targetScore: 120,
        budgetMinutes: 0,
      }),
    ).toEqual({ maxRounds: 2, targetScore: 100, budgetMs: 60_000 })
    expect(resolveRefineConfig({ maxRounds: 'abc' }).maxRounds).toBe(3)
    expect(resolveRefineConfig({ maxRounds: 0 }).maxRounds).toBe(0)
  })
})

function draftCapture(sections: number): ReferenceCapture {
  const base = fakeCapture()
  const children = Array.from({ length: sections }, (_, index) => ({
    y: index * 1000,
    height: 1000,
    tag: 'section',
    style: {},
    text: '',
  }))
  return {
    ...base,
    desktop: {
      ...base.desktop,
      blocks: [
        { y: 0, height: 80, tag: 'div', style: {}, text: '' },
        {
          y: 80,
          height: sections * 1000,
          tag: 'main',
          style: {},
          text: '',
          children: children.map((child) => ({ ...child, y: child.y + 80 })),
        },
      ],
    },
  }
}

describe('draft ranges and strips', () => {
  it('reads the sections from the main block', () => {
    expect(draftSectionRanges(draftCapture(2), 2)).toEqual([
      { yStart: 80, yEnd: 1080 },
      { yStart: 1080, yEnd: 2080 },
    ])
  })

  it('trusts the top-level blocks when the page has no main block', () => {
    const base = fakeCapture()
    expect(draftSectionRanges(base, 2)?.length).toBe(2)
  })

  it('gives up when the number of sections does not match', () => {
    expect(draftSectionRanges(draftCapture(2), 3)).toBeNull()
  })

  it('picks the strips of a range with their page offsets', () => {
    const capture = fakeCapture()
    const pick = pickStrips(capture, { yStart: 1100, yEnd: 1500 })
    expect(pick.images).toEqual([capture.desktop.strips[1]])
    expect(pick.firstY).toBe(1000)
    expect(pick.lastY).toBe(2000)
  })
})

describe('swapSection', () => {
  const twoSections = () => toDocument([section({}, []), section({}, [])])

  it('replaces one section, keeps the others and can undo it', () => {
    const doc = twoSections()
    const before = doc.nodes[doc.rootId].children ?? []
    const swapped = swapSection(doc, 1, section({}, []))
    expect(swapped.ok).toBe(true)
    if (!swapped.ok) return
    const after = swapped.doc.nodes[swapped.doc.rootId].children ?? []
    expect(after).toHaveLength(2)
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    expect(swapped.doc.nodes[before[1]]).toBeUndefined()
    const restored = swapped.undo(swapped.doc)
    expect(restored.nodes[restored.rootId].children).toEqual(before)
    expect(restored.nodes[before[1]]).toBeDefined()
    expect(Object.keys(restored.nodes).sort()).toEqual(
      Object.keys(doc.nodes).sort(),
    )
  })

  it('refuses an index that does not exist', () => {
    const swapped = swapSection(twoSections(), 5, section({}, []))
    expect(swapped.ok).toBe(false)
  })

  it('undo puts the old section back even after another section changed', () => {
    const doc = twoSections()
    const first = swapSection(doc, 0, section({}, []))
    if (!first.ok) throw new Error('swap failed')
    const second = swapSection(first.doc, 1, section({}, []))
    if (!second.ok) throw new Error('swap failed')
    const restored = first.undo(second.doc)
    const children = restored.nodes[restored.rootId].children ?? []
    expect(children[0]).toBe((doc.nodes[doc.rootId].children ?? [])[0])
    expect(children[1]).toBe(
      (second.doc.nodes[second.doc.rootId].children ?? [])[1],
    )
  })
})

describe('compareSection', () => {
  const input = (model: ReturnType<typeof llm>) => ({
    llm: model.llm,
    sectionName: 'Destaque',
    purpose: 'Apresentar a padaria',
    referenceImages: ['data:image/jpeg;base64,AAA'],
    referenceNote: 'ref',
    draftImages: ['data:image/jpeg;base64,BBB'],
    draftNote: 'draft',
  })

  it('returns the clamped score and the differences, and meters usage', async () => {
    const model = llm(() => ({
      score: 71.6,
      differences: [
        {
          aspect: 'columns',
          severity: 'high',
          description: 'A referência tem 3 colunas e o rascunho 2.',
          fix: 'Passar para 3 colunas.',
        },
      ],
    }))
    const result = await compareSection(input(model))
    expect(result).toEqual({
      ok: true,
      comparison: {
        score: 72,
        differences: [
          expect.objectContaining({ aspect: 'columns', severity: 'high' }),
        ],
      },
    })
    expect(model.onUsage).toHaveBeenCalled()
    const call = model.chat.mock.calls[0] as unknown as [
      { messages: Array<{ content: unknown }> },
    ]
    const content = call[0].messages[0].content as Array<{ type: string }>
    expect(content.filter((part) => part.type === 'image')).toHaveLength(2)
  })

  it('fails softly when the score is out of range or the provider fails', async () => {
    const bad = await compareSection(
      input(llm(() => ({ score: 180, differences: [] }))),
    )
    expect(bad.ok).toBe(false)
    const model = llm(() => {
      throw new Error('boom')
    })
    const failed = await compareSection(input(model))
    expect(failed.ok).toBe(false)
  })

  it('describes the pictures and turns differences into instructions', () => {
    const message = buildCompareMessage({
      ...input(llm(() => ({}))),
    })
    expect(message).toContain('REFERÊNCIA')
    expect(message).toContain('RASCUNHO')
    const lines = differencesToInstructions([
      {
        aspect: 'size',
        severity: 'medium',
        description: 'Título menor.',
        fix: 'Subir para 56px.',
      },
    ])
    expect(lines[0]).toContain('média')
    expect(lines[0]).toContain('tamanhos')
    expect(lines[0]).toContain('Subir para 56px.')
  })
})

/** A fake draft whose sections have versions: a swap bumps it, an undo
 * lowers it, and the fake comparison reads the score from a table. */
function fakeDraft(options: { renderFails?: boolean } = {}) {
  const versions = new Map<string, number>()
  const swaps: string[] = []
  const draft: RefineDraft = {
    render: vi.fn(async () =>
      options.renderFails
        ? err(appError('INTERNAL_SERVER_ERROR', 'falhou'))
        : ok(draftCapture(2)),
    ),
    ranges: (capture) => draftSectionRanges(capture, 2),
    swap: (pageIndex, sectionIndex) => {
      const key = `${pageIndex}:${sectionIndex}`
      versions.set(key, (versions.get(key) ?? 0) + 1)
      swaps.push(key)
      return {
        ok: true,
        undo: () => versions.set(key, (versions.get(key) ?? 1) - 1),
      }
    },
  }
  return { draft, versions, swaps }
}

const target = (over: Partial<RefineTarget> = {}): RefineTarget => ({
  id: '0:0',
  pageIndex: 0,
  sectionIndex: 0,
  name: 'Destaque',
  purpose: 'Apresentar a padaria',
  referenceImages: ['data:image/jpeg;base64,AAA'],
  referenceNote: 'ref',
  blueprint: null,
  ...over,
})

const difference = {
  aspect: 'size' as const,
  severity: 'high' as const,
  description: 'Título pequeno',
  fix: 'Aumentar o título',
}

function harness(
  scores: Record<string, number[]>,
  options: {
    targets?: RefineTarget[]
    maxRounds?: number
    targetScore?: number
    budgetMs?: number
    renderFails?: boolean
    redrawFails?: boolean
    overBudget?: () => boolean
    now?: () => number
    onRedraw?: () => void
  } = {},
) {
  const fake = fakeDraft({ renderFails: options.renderFails })
  const progress: string[] = []
  const compare = vi.fn(async (item: { target: RefineTarget }) => {
    const table = scores[item.target.id]
    const version = fake.versions.get(item.target.id) ?? 0
    return {
      ok: true as const,
      comparison: {
        score: table[Math.min(version, table.length - 1)],
        differences: [difference],
      },
    }
  })
  const redraw = vi.fn(async () => {
    options.onRedraw?.()
    return options.redrawFails
      ? { ok: false as const, problems: ['x'] }
      : {
          ok: true as const,
          spec: section({}, []),
          blueprint: fakeHeroBlueprint(),
        }
  })
  const run = (override: Partial<RefineInput> = {}) =>
    refineDraft({
      draft: fake.draft,
      targets: options.targets ?? [target()],
      config: {
        maxRounds: options.maxRounds ?? 3,
        targetScore: options.targetScore ?? 85,
        budgetMs: options.budgetMs ?? 60_000,
      },
      compare,
      redraw,
      onProgress: (label) => progress.push(label),
      overBudget: options.overBudget,
      now: options.now,
      ...override,
    })
  return { ...fake, compare, redraw, progress, run }
}

describe('refineDraft', () => {
  it('leaves sections that already meet the target alone', async () => {
    const h = harness({ '0:0': [92] })
    const outcome = await h.run()
    expect(outcome.stoppedBy).toBe('target')
    expect(outcome.rounds).toBe(0)
    expect(outcome.replaced).toBe(0)
    expect(h.redraw).not.toHaveBeenCalled()
    expect(outcome.sections[0]).toMatchObject({
      initialScore: 92,
      finalScore: 92,
    })
    expect(outcome.warnings).toEqual([])
    expect(h.progress[0]).toBe('Comparando com a referência…')
  })

  it('redraws a weak section and keeps the change that raised the score', async () => {
    const h = harness({ '0:0': [60, 90] })
    const outcome = await h.run()
    expect(outcome.stoppedBy).toBe('target')
    expect(outcome.rounds).toBe(1)
    expect(outcome.replaced).toBe(1)
    expect(outcome.sections[0]).toMatchObject({
      initialScore: 60,
      finalScore: 90,
      fixes: 1,
    })
    expect(outcome.averageBefore).toBe(60)
    expect(outcome.averageAfter).toBe(90)
    expect(h.versions.get('0:0')).toBe(1)
    expect(h.progress).toContain('Ajustando a seção "Destaque" (rodada 1)…')
    const call = (
      h.redraw.mock.calls[0] as unknown as [{ score: number; round: number }]
    )[0]
    expect(call).toMatchObject({ score: 60, round: 1 })
  })

  it('undoes a redraw that made the section worse and stops improving it', async () => {
    const h = harness({ '0:0': [60, 50] })
    const outcome = await h.run()
    expect(outcome.stoppedBy).toBe('stalled')
    expect(outcome.replaced).toBe(0)
    expect(outcome.sections[0].finalScore).toBe(60)
    expect(h.versions.get('0:0')).toBe(0)
    expect(h.redraw).toHaveBeenCalledTimes(1)
    expect(outcome.warnings[0]).toContain('deixaram de melhorar')
  })

  it('treats a gain below the minimum as no improvement', async () => {
    const h = harness({ '0:0': [60, 61] })
    const outcome = await h.run()
    expect(outcome.stoppedBy).toBe('stalled')
    expect(h.versions.get('0:0')).toBe(0)
  })

  it('stops when the rounds run out and says which sections are below the target', async () => {
    const h = harness({ '0:0': [50, 60, 70] }, { maxRounds: 2 })
    const outcome = await h.run()
    expect(outcome.stoppedBy).toBe('rounds')
    expect(outcome.rounds).toBe(2)
    expect(outcome.replaced).toBe(2)
    expect(outcome.sections[0].finalScore).toBe(70)
    expect(outcome.warnings[0]).toContain('2 rodadas')
    expect(outcome.warnings[0]).toContain('"Destaque"')
  })

  it('only redraws the sections under the target', async () => {
    const h = harness(
      { '0:0': [90], '0:1': [55, 88] },
      {
        targets: [
          target(),
          target({ id: '0:1', sectionIndex: 1, name: 'Planos' }),
        ],
      },
    )
    const outcome = await h.run()
    expect(h.swaps).toEqual(['0:1'])
    expect(outcome.sections.map((item) => item.finalScore)).toEqual([90, 88])
    expect(outcome.stoppedBy).toBe('target')
  })

  it('stops on time and undoes what was not verified', async () => {
    const clock = { t: 0 }
    const h = harness(
      { '0:0': [50, 95] },
      {
        budgetMs: 1_000,
        now: () => clock.t,
        onRedraw: () => {
          clock.t = 5_000
        },
      },
    )
    const outcome = await h.run()
    expect(outcome.stoppedBy).toBe('time')
    expect(h.versions.get('0:0')).toBe(0)
    expect(outcome.replaced).toBe(0)
    expect(outcome.sections[0].finalScore).toBe(50)
    expect(outcome.warnings[0]).toContain('limite de tempo')
  })

  it('stops when the monthly AI quota is spent', async () => {
    const h = harness({ '0:0': [50, 95] })
    const outcome = await h.run({
      overBudget: () => h.compare.mock.calls.length >= 1,
    })
    expect(outcome.stoppedBy).toBe('quota')
    expect(h.redraw).not.toHaveBeenCalled()
    expect(outcome.warnings[0]).toContain('cota mensal')
  })

  it('keeps the draft untouched when it cannot be rendered', async () => {
    const h = harness({ '0:0': [50] }, { renderFails: true })
    const outcome = await h.run()
    expect(outcome.stoppedBy).toBe('render_failed')
    expect(h.redraw).not.toHaveBeenCalled()
    expect(h.swaps).toEqual([])
    expect(outcome.warnings[0]).toContain('renderizar')
  })

  it('keeps the draft untouched when the comparison fails', async () => {
    const h = harness({ '0:0': [50] })
    const outcome = await h.run({
      compare: async () => ({ ok: false, problems: ['x'] }),
    })
    expect(outcome.stoppedBy).toBe('compare_failed')
    expect(h.swaps).toEqual([])
    expect(outcome.sections[0].finalScore).toBeNull()
    expect(outcome.averageAfter).toBeNull()
  })

  it('does not throw when the renderer or the comparison throw', async () => {
    const h = harness({ '0:0': [50] })
    const throwing = await h.run({
      draft: {
        ...h.draft,
        render: async () => {
          throw new Error('chromium crashed')
        },
      },
    })
    expect(throwing.stoppedBy).toBe('render_failed')
    const compareThrows = await h.run({
      compare: async () => {
        throw new Error('boom')
      },
    })
    expect(compareThrows.stoppedBy).toBe('compare_failed')
  })

  it('marks a section stalled when its redraw fails', async () => {
    const h = harness({ '0:0': [50, 95] }, { redrawFails: true })
    const outcome = await h.run()
    expect(outcome.stoppedBy).toBe('stalled')
    expect(h.swaps).toEqual([])
    expect(outcome.replaced).toBe(0)
  })

  it('undoes the changes of a page that cannot be rendered again', async () => {
    const h = harness({ '0:0': [50, 95] })
    let renders = 0
    const outcome = await h.run({
      draft: {
        ...h.draft,
        render: async (pageIndex) => {
          renders++
          return renders === 1
            ? h.draft.render(pageIndex)
            : err(appError('INTERNAL_SERVER_ERROR', 'falhou'))
        },
      },
    })
    expect(h.versions.get('0:0')).toBe(0)
    expect(outcome.replaced).toBe(0)
    expect(outcome.warnings.join(' ')).toContain('desfeitas')
  })
})

describe('buildRefineTargets and runRefinement', () => {
  const sectionCtx: SectionContext = {
    kit: SITE_KITS.saas,
    companyName: 'Padaria',
    logoUrl: null,
    ctaLabel: 'Fale com a gente',
    contactLink: { type: 'anchor', value: 'contato' },
    products: [],
    testimonials: [],
    form: null,
    eventDate: null,
    pageTitle: 'Início',
  }
  const spec = fakeDesignSpec()
  const source: ReferenceSource = {
    id: 'ref1',
    label: 'https://ref.example/home',
    kind: 'link',
    images: fakeCapture().desktop.strips,
    capture: fakeCapture(),
    summary: null,
  }
  const planned = (over: Partial<PlannedSection> = {}): PlannedSection => ({
    name: 'Destaque',
    purpose: 'Apresentar a padaria',
    equivalent: 'hero',
    referenceId: 'ref1',
    referenceSection: 0,
    ...over,
  })
  const requestFor = (
    item: PlannedSection,
    referenceSection = spec.sections[0],
  ): SectionRequest => ({
    planned: item,
    pageTitle: 'Início',
    index: 0,
    total: 2,
    primary: spec,
    reference: { source, spec, section: referenceSection },
    brief: ['Empresa: Padaria'],
    focus: '',
    companyName: 'Padaria',
    ctaLabel: 'Fale com a gente',
  })
  const record = (
    item: PlannedSection,
    over: Partial<SectionRecord> = {},
  ): SectionRecord => ({
    request: requestFor(item),
    sectionCtx,
    brandColor: null,
    blueprint: fakeHeroBlueprint(),
    origin: 'blueprint',
    ...over,
  })
  const fidelityOf = (sections: PlannedSection[]) =>
    ({
      plan: {
        pages: [{ kind: 'home', title: 'Início', sections }],
      },
    }) as unknown as Extract<FidelityResult, { ok: true }>

  it('skips data sections and references without a position', () => {
    const hero = planned()
    const products = planned({ name: 'Produtos', equivalent: 'products' })
    const noRange = planned({ name: 'Sem faixa' })
    const recorder = createSectionRecorder()
    recorder.records.set(hero, record(hero))
    recorder.records.set(products, record(products))
    recorder.records.set(noRange, {
      ...record(noRange),
      request: requestFor(noRange, {
        ...spec.sections[0],
        yStart: null,
        yEnd: null,
      }),
    })
    const { targets } = buildRefineTargets(
      fidelityOf([hero, products, noRange]),
      recorder,
    )
    expect(targets.map((item) => item.id)).toEqual(['0:0'])
    expect(targets[0].referenceImages.length).toBeGreaterThan(0)
    expect(targets[0].referenceNote).toContain('y=')
    expect(targets[0].blueprint).not.toBeNull()
  })

  it('uses the picture of the customer as the reference of an image source', () => {
    const hero = planned()
    const recorder = createSectionRecorder()
    const imageSource: ReferenceSource = {
      id: 'ref1',
      label: 'Imagem 1',
      kind: 'image',
      images: ['data:image/png;base64,ZZZ'],
      capture: null,
      summary: null,
    }
    recorder.records.set(hero, {
      ...record(hero),
      request: {
        ...requestFor(hero),
        reference: { source: imageSource, spec, section: spec.sections[0] },
      },
    })
    const { targets } = buildRefineTargets(fidelityOf([hero]), recorder)
    expect(targets[0].referenceImages).toEqual(['data:image/png;base64,ZZZ'])
  })

  it('refines a real page document end to end', async () => {
    const hero = planned()
    const other = planned({ name: 'Serviços', equivalent: 'services' })
    const recorder = createSectionRecorder()
    recorder.records.set(hero, record(hero))
    recorder.records.set(
      other,
      record(other, {
        request: { ...requestFor(other), reference: null },
      }),
    )
    const document: CanvasDocument = toDocument([
      section({}, []),
      section({}, []),
    ])
    const originalFirst = (document.nodes[document.rootId].children ?? [])[0]
    const rendered: ReferenceCapture[] = []
    const render = vi.fn(async () => {
      const capture = draftCapture(2)
      rendered.push(capture)
      return ok(capture)
    })
    let comparisons = 0
    const model = llm(() => fakeHeroBlueprint())
    const progress: string[] = []
    const result = await runRefinement({
      fidelity: fidelityOf([hero, other]),
      recorder,
      llm: model.llm,
      config: { maxRounds: 3, targetScore: 85, budgetMs: 60_000 },
      theme: {},
      header: null,
      footer: null,
      pages: [{ title: 'Início', document }],
      render,
      prepare: vi.fn(),
      onProgress: (label) => progress.push(label),
      deps: {
        compare: async () => ({
          ok: true,
          comparison: {
            score: comparisons++ === 0 ? 55 : 92,
            differences: [difference],
          },
        }),
      },
    })
    expect(result.ran).toBe(true)
    if (!result.ran) return
    expect(result.outcome.replaced).toBe(1)
    expect(result.outcome.sections).toHaveLength(1)
    expect(result.outcome.averageAfter).toBe(92)
    const [next] = result.documents
    const children = next.nodes[next.rootId].children ?? []
    expect(children).toHaveLength(2)
    expect(children[0]).not.toBe(originalFirst)
    expect(render).toHaveBeenCalledTimes(2)
    // The redraw carried the differences and the current render to the model.
    const sent = model.chat.mock.calls[0] as unknown as [
      { messages: Array<{ content: unknown }> },
    ]
    const parts = sent[0].messages[0].content as Array<{
      type: string
      text?: string
    }>
    expect(parts.find((part) => part.type === 'text')?.text).toContain(
      'AJUSTE FINO',
    )
    expect(progress).toContain('Ajustando a seção "Destaque" (rodada 1)…')
  })

  it('does not run when disabled or when nothing can be compared', async () => {
    const base = {
      fidelity: fidelityOf([planned()]),
      recorder: createSectionRecorder(),
      llm: llm(() => ({})).llm,
      theme: {},
      header: null,
      footer: null,
      pages: [{ title: 'Início', document: toDocument([section({}, [])]) }],
      render: async () => ok(draftCapture(1)),
      onProgress: () => undefined,
    }
    expect(
      await runRefinement({
        ...base,
        config: { maxRounds: 0, targetScore: 85, budgetMs: 1000 },
      }),
    ).toEqual({ ran: false, reason: 'disabled' })
    expect(
      await runRefinement({
        ...base,
        config: { maxRounds: 3, targetScore: 85, budgetMs: 1000 },
      }),
    ).toEqual({ ran: false, reason: 'no_targets' })
  })
})

describe('createDraftRenderer', () => {
  it('parks the draft behind a signed token and captures the preview URL', async () => {
    const stored = new Map<string, string>()
    const redis = {
      set: vi.fn(async (key: string, value: string) => {
        stored.set(key, value)
        return 'OK'
      }),
      get: vi.fn(async (key: string) => stored.get(key) ?? null),
    }
    const capture = vi.fn(async (_url: string) => ok(draftCapture(1)))
    const render = createDraftRenderer({
      redis,
      port: { capture },
      publicOrigin: 'https://app.example.com/some/path',
      secret: SECRET,
    })
    const doc = toDocument([section({}, [])])
    const result = await render(
      {
        theme: {},
        header: null,
        footer: null,
        pages: [{ title: 'Início', document: doc }],
      },
      1,
    )
    expect(result.ok).toBe(true)
    const url = new URL(capture.mock.calls[0][0])
    expect(url.origin).toBe('https://app.example.com')
    expect(url.searchParams.get('p')).toBe('1')
    const token = url.pathname.replace('/site-preview/', '')
    const id = verifyPreviewToken(SECRET, token)
    expect(id).not.toBeNull()
    expect(redis.set).toHaveBeenCalledWith(
      `site-ai:preview:${id}`,
      expect.any(String),
      'EX',
      expect.any(Number),
    )
  })

  it('returns a pt-BR error instead of throwing', async () => {
    const render = createDraftRenderer({
      redis: {
        set: async () => {
          throw new Error('redis down')
        },
        get: async () => null,
      },
      port: { capture: async () => ok(draftCapture(1)) },
      publicOrigin: 'https://app.example.com',
      secret: SECRET,
    })
    const result = await render(
      { theme: {}, header: null, footer: null, pages: [] },
      0,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('renderizar')
  })
})
