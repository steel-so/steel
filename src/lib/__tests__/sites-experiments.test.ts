import { describe, expect, it } from 'vitest'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import {
  applyVariantChoices,
  assignVariant,
  clickableNodes,
  type ExperimentVariant,
  evenWeights,
  experimentState,
  goalAnchorOf,
  hash32,
  isExperimentLive,
  missingVariants,
  planExperiments,
  promoteSectionVariant,
  type RuntimeExperiment,
  removeSectionVariants,
  testableSections,
  variantMetaOf,
  variantName,
  visitorBucket,
  withGoalAnchors,
} from '@/src/lib/sites/experiments'
import type { SiteSnapshotPage } from '@/src/lib/sites/snapshot'

/** root > [s1 (h1), s1b (variant B of s1, h1b), s2 (button b1)] */
function testDoc(): CanvasDocument {
  const base = createSiteDocument('Original')
  const heading = base.nodes.h1
  return {
    ...base,
    nodes: {
      ...base.nodes,
      root: { ...base.nodes.root, children: ['s1', 's1b', 's2'] },
      s1: { ...base.nodes.s1, meta: { name: 'Hero' } },
      s1b: {
        ...base.nodes.s1,
        id: 's1b',
        props: { ...base.nodes.s1.props, anchor: '' },
        children: ['h1b'],
        meta: {
          name: 'Variante B',
          variantOf: 's1',
          variantKey: 'B',
        } as CanvasNode['meta'],
      },
      h1b: { ...heading, id: 'h1b', props: { ...heading.props, text: 'B' } },
      s2: { ...base.nodes.s1, id: 's2', children: ['b1'] },
      b1: {
        id: 'b1',
        type: 'site.button',
        props: { label: 'Comprar', link: { type: 'url', value: '/x' } },
      },
    },
  }
}

const variants: ExperimentVariant[] = [
  { key: 'A', name: 'Original', weight: 50, nodeId: 's1' },
  { key: 'B', name: 'Variante B', weight: 50, nodeId: 's1b' },
]

function experiment(
  overrides: Partial<RuntimeExperiment> = {},
): RuntimeExperiment {
  return {
    id: 'exp1',
    kind: 'SECTION',
    pageId: 'home',
    controlNodeId: 's1',
    variants,
    goal: { type: 'FORM' },
    status: 'RUNNING',
    startsAt: null,
    endsAt: null,
    run: 1,
    ...overrides,
  }
}

function page(id: string, document: CanvasDocument): SiteSnapshotPage {
  return {
    id,
    parentId: null,
    title: id,
    slug: id,
    path: id,
    position: 0,
    isHome: id === 'home',
    seo: {},
    document,
  }
}

const NOW = new Date('2026-10-15T12:00:00Z')

describe('assignment', () => {
  it('hashes deterministically into 32 bits', () => {
    expect(hash32('abc')).toBe(hash32('abc'))
    expect(hash32('abc')).not.toBe(hash32('abd'))
    expect(hash32('')).toBeGreaterThanOrEqual(0)
    const bucket = visitorBucket('e', 'k')
    expect(bucket).toBeGreaterThanOrEqual(0)
    expect(bucket).toBeLessThan(100)
  })

  it('always gives the same visitor the same variant', () => {
    for (let i = 0; i < 50; i++) {
      const key = `visitor-${i}`
      expect(assignVariant(variants, 'exp1', key)).toBe(
        assignVariant(variants, 'exp1', key),
      )
    }
  })

  it('spreads visitors by weight', () => {
    const split: ExperimentVariant[] = [
      { key: 'A', name: 'A', weight: 20 },
      { key: 'B', name: 'B', weight: 30 },
      { key: 'C', name: 'C', weight: 50 },
    ]
    const counts = { A: 0, B: 0, C: 0 }
    const total = 20000
    for (let i = 0; i < total; i++) {
      counts[assignVariant(split, 'exp-split', `v${i}`)]++
    }
    expect(counts.A / total).toBeCloseTo(0.2, 1)
    expect(counts.B / total).toBeCloseTo(0.3, 1)
    expect(counts.C / total).toBeCloseTo(0.5, 1)
  })

  it('assigns independently per experiment', () => {
    const same = Array.from({ length: 200 }, (_, i) => `v${i}`).filter(
      (key) =>
        assignVariant(variants, 'one', key) ===
        assignVariant(variants, 'two', key),
    )
    expect(same.length).toBeGreaterThan(60)
    expect(same.length).toBeLessThan(140)
  })

  it('falls back to the control without usable weights', () => {
    expect(assignVariant([], 'e', 'k')).toBe('A')
    expect(assignVariant([{ key: 'B', name: 'B', weight: 0 }], 'e', 'k')).toBe(
      'A',
    )
    expect(
      assignVariant(
        [
          { key: 'A', name: 'A', weight: -5 },
          { key: 'B', name: 'B', weight: 10 },
        ],
        'e',
        'k',
      ),
    ).toBe('B')
  })

  it('splits evenly and names the variants', () => {
    expect(evenWeights(2)).toEqual([50, 50])
    expect(evenWeights(3)).toEqual([34, 33, 33])
    expect(variantName('A')).toBe('Original')
    expect(variantName('C')).toBe('Variante C')
  })
})

describe('schedule', () => {
  it('derives the shown state from status and schedule', () => {
    expect(experimentState(experiment({ status: 'DRAFT' }), NOW)).toBe('DRAFT')
    expect(experimentState(experiment({ status: 'PAUSED' }), NOW)).toBe(
      'PAUSED',
    )
    expect(experimentState(experiment(), NOW)).toBe('RUNNING')
    expect(
      experimentState(experiment({ startsAt: '2026-10-16T00:00:00Z' }), NOW),
    ).toBe('SCHEDULED')
    expect(
      experimentState(experiment({ endsAt: '2026-10-15T11:00:00Z' }), NOW),
    ).toBe('ENDED')
    expect(
      isExperimentLive(
        experiment({
          startsAt: '2026-10-01T00:00:00Z',
          endsAt: '2026-10-20T00:00:00Z',
        }),
        NOW,
      ),
    ).toBe(true)
    expect(isExperimentLive(experiment({ status: 'ENDED' }), NOW)).toBe(false)
  })
})

describe('documents', () => {
  it('reads the variant marker', () => {
    const doc = testDoc()
    expect(variantMetaOf(doc.nodes.s1b)).toEqual({
      variantOf: 's1',
      variantKey: 'B',
    })
    expect(variantMetaOf(doc.nodes.s1)).toEqual({})
    expect(variantMetaOf(undefined)).toEqual({})
    expect(
      variantMetaOf({
        ...doc.nodes.s1,
        meta: { variantOf: 's9' } as CanvasNode['meta'],
      }),
    ).toEqual({ variantOf: 's9' })
  })

  it('drops variants without a choice and keeps the control', () => {
    const doc = testDoc()
    const shown = applyVariantChoices(doc)
    expect(shown.nodes.root.children).toEqual(['s1', 's2'])
    expect(shown.nodes.s1b).toBeUndefined()
    expect(shown.nodes.h1b).toBeUndefined()
    // The input is untouched.
    expect(doc.nodes.root.children).toEqual(['s1', 's1b', 's2'])
  })

  it('puts the chosen variant in the control place', () => {
    const shown = applyVariantChoices(testDoc(), { s1: 's1b' })
    expect(shown.nodes.root.children).toEqual(['s1b', 's2'])
    expect(shown.nodes.s1).toBeUndefined()
    expect(shown.nodes.h1b).toBeDefined()
  })

  it('ignores a choice whose node is missing and returns plain docs as is', () => {
    const shown = applyVariantChoices(testDoc(), { s1: 'gone' })
    expect(shown.nodes.root.children).toEqual(['s1', 's2'])
    const plain = createSiteDocument()
    expect(applyVariantChoices(plain)).toBe(plain)
    expect(
      applyVariantChoices(plain, { s1: 's1' }).nodes.root.children,
    ).toEqual(['s1'])
  })

  it('anchors click goals', () => {
    const doc = testDoc()
    const { doc: anchored, anchors } = withGoalAnchors(doc, ['b1', 's1', 'x'])
    expect(anchors).toEqual({ b1: 'ss-goal-b1', s1: 'inicio' })
    expect(anchored.nodes.b1.props.anchor).toBe('ss-goal-b1')
    expect(doc.nodes.b1.props.anchor).toBeUndefined()
    expect(goalAnchorOf(doc.nodes.s1)).toBe('inicio')
    const none = withGoalAnchors(doc, ['s1'])
    expect(none.doc).toBe(doc)
  })

  it('promotes a winning variant into the control place', () => {
    const doc = testDoc()
    const next = promoteSectionVariant(doc, {
      controlId: 's1',
      variantIds: ['s1', 's1b'],
      winnerId: 's1b',
    }) as CanvasDocument
    expect(next.nodes.root.children).toEqual(['s1b', 's2'])
    expect(next.nodes.s1).toBeUndefined()
    expect(next.nodes.h1).toBeUndefined()
    expect(next.nodes.s1b.meta).toEqual({ name: 'Hero' })
  })

  it('keeps the control and removes the challengers when the control wins', () => {
    const next = promoteSectionVariant(testDoc(), {
      controlId: 's1',
      variantIds: ['s1', 's1b'],
      winnerId: 's1',
    }) as CanvasDocument
    expect(next.nodes.root.children).toEqual(['s1', 's2'])
    expect(next.nodes.s1b).toBeUndefined()
    expect(
      removeSectionVariants(testDoc(), ['s1b']).nodes.root.children,
    ).toEqual(['s1', 's2'])
    // The root and unknown ids are left alone.
    expect(
      removeSectionVariants(testDoc(), ['root', 'nope']).nodes.root.children,
    ).toEqual(['s1', 's1b', 's2'])
  })

  it('handles a missing winner or a deleted control', () => {
    expect(
      promoteSectionVariant(testDoc(), {
        controlId: 's1',
        variantIds: ['s1', 'zz'],
        winnerId: 'zz',
      }),
    ).toBeNull()
    const doc = testDoc()
    delete doc.nodes.s1
    doc.nodes.root = { ...doc.nodes.root, children: ['s1b', 's2'] }
    const next = promoteSectionVariant(doc, {
      controlId: 's1',
      variantIds: ['s1', 's1b'],
      winnerId: 's1b',
    }) as CanvasDocument
    expect(next.nodes.root.children).toEqual(['s1b', 's2'])
    expect(next.nodes.s1b.meta).toBeUndefined()
  })

  it('moves a winner that lives elsewhere in the tree', () => {
    const doc = testDoc()
    doc.nodes.root = { ...doc.nodes.root, children: ['s1', 's2'] }
    doc.nodes.s2 = { ...doc.nodes.s2, children: ['b1', 's1b'] }
    const next = promoteSectionVariant(doc, {
      controlId: 's1',
      variantIds: ['s1', 's1b'],
      winnerId: 's1b',
    }) as CanvasDocument
    expect(next.nodes.root.children).toEqual(['s1b', 's2'])
    expect(next.nodes.s2.children).toEqual(['b1'])
  })

  it('lists testable sections and clickable elements', () => {
    const doc = testDoc()
    expect(testableSections(doc)).toEqual([
      { id: 's1', name: 'Hero' },
      { id: 's2', name: null },
    ])
    expect(clickableNodes(doc)).toEqual([
      { id: 'b1', type: 'site.button', label: 'Comprar' },
    ])
    doc.nodes.h1 = {
      ...doc.nodes.h1,
      props: { ...doc.nodes.h1.props, link: { type: 'page', value: 'p' } },
    }
    doc.nodes.h1b = {
      ...doc.nodes.h1b,
      props: { ...doc.nodes.h1b.props, link: { type: 'none' } },
    }
    expect(clickableNodes(doc).map((item) => item.label)).toContain('Original')
    expect(clickableNodes(doc).map((item) => item.id)).not.toContain('h1b')
    const empty = {
      ...doc,
      nodes: { root: { ...doc.nodes.root, children: [] } },
    }
    expect(testableSections(empty)).toEqual([])
    doc.nodes.icon = {
      id: 'icon',
      type: 'site.icon',
      props: { link: { type: 'url', value: '/' } },
    }
    doc.nodes.s2 = { ...doc.nodes.s2, children: ['b1', 'icon'] }
    expect(clickableNodes(doc).find((item) => item.id === 'icon')?.label).toBe(
      'icon',
    )
  })
})

describe('missingVariants', () => {
  it('checks section nodes in the test page', () => {
    const pages = [page('home', testDoc())]
    expect(missingVariants(experiment(), pages)).toEqual([])
    expect(missingVariants(experiment({ pageId: 'gone' }), pages)).toEqual([
      'A',
      'B',
    ])
    expect(
      missingVariants(
        experiment({
          variants: [variants[0], { key: 'B', name: 'B', weight: 50 }],
        }),
        pages,
      ),
    ).toEqual(['B'])
  })

  it('checks pages of a page test', () => {
    const pages = [page('home', testDoc()), page('home-b', testDoc())]
    const pageTest = experiment({
      kind: 'PAGE',
      controlNodeId: null,
      variants: [
        { key: 'A', name: 'A', weight: 50, pageId: 'home' },
        { key: 'B', name: 'B', weight: 50, pageId: 'home-b' },
        { key: 'C', name: 'C', weight: 0 },
      ],
    })
    expect(missingVariants(pageTest, pages)).toEqual(['C'])
  })
})

describe('planExperiments', () => {
  const home = page('home', testDoc())

  function keyFor(target: 'A' | 'B', experimentId = 'exp1') {
    for (let i = 0; i < 1000; i++) {
      if (assignVariant(variants, experimentId, `k${i}`) === target) {
        return `k${i}`
      }
    }
    throw new Error('no key')
  }

  it('renders the assigned section and tracks the exposure', () => {
    const plan = planExperiments({
      snapshot: { pages: [home] },
      page: home,
      experiments: [experiment()],
      visitorKey: keyFor('B'),
      now: NOW,
    })
    expect(plan.assignments).toEqual({ exp1: 'B' })
    expect(plan.document.nodes.root.children).toEqual(['s1b', 's2'])
    expect(plan.entries()).toEqual([{ id: 'exp1', x: true, g: { t: 'form' } }])
  })

  it('keeps the control for A and for tests that are not live', () => {
    const control = planExperiments({
      snapshot: { pages: [home] },
      page: home,
      experiments: [experiment({ goal: { type: 'FORM', formToken: 'tok' } })],
      visitorKey: keyFor('A'),
      now: NOW,
    })
    expect(control.document.nodes.root.children).toEqual(['s1', 's2'])
    expect(control.entries()).toEqual([
      { id: 'exp1', x: true, g: { t: 'form', f: 'tok' } },
    ])

    const paused = planExperiments({
      snapshot: { pages: [home] },
      page: home,
      experiments: [
        experiment({ status: 'PAUSED' }),
        experiment({ id: 'missing', variants: [variants[0]], pageId: 'zz' }),
      ],
      visitorKey: keyFor('B'),
      now: NOW,
    })
    expect(paused.document.nodes.root.children).toEqual(['s1', 's2'])
    expect(paused.entries()).toEqual([])
  })

  it('renders the assigned page variant at the control address', () => {
    const variantDoc = createSiteDocument('Página B')
    const pages = [
      home,
      page('home-b', variantDoc),
      page('obrigado', testDoc()),
    ]
    const pageVariants: ExperimentVariant[] = [
      { key: 'A', name: 'A', weight: 50, pageId: 'home' },
      { key: 'B', name: 'B', weight: 50, pageId: 'home-b' },
    ]
    const pageTest = experiment({
      id: 'exp-page',
      kind: 'PAGE',
      controlNodeId: null,
      variants: pageVariants,
      goal: { type: 'PAGE', pageId: 'obrigado' },
    })
    let key = ''
    for (let i = 0; i < 1000 && !key; i++) {
      if (assignVariant(pageVariants, 'exp-page', `p${i}`) === 'B')
        key = `p${i}`
    }
    const plan = planExperiments({
      snapshot: { pages },
      page: home,
      experiments: [pageTest],
      visitorKey: key,
      now: NOW,
    })
    expect(plan.document.nodes.h1.props.text).toBe('Página B')
    expect(plan.entries()).toEqual([{ id: 'exp-page', x: true }])

    const goal = planExperiments({
      snapshot: { pages },
      page: pages[2],
      experiments: [pageTest],
      visitorKey: key,
      now: NOW,
    })
    expect(goal.entries()).toEqual([
      { id: 'exp-page', x: false, g: { t: 'page' } },
    ])

    const elsewhere = planExperiments({
      snapshot: { pages: [...pages, page('sobre', testDoc())] },
      page: page('sobre', testDoc()),
      experiments: [pageTest],
      visitorKey: key,
      now: NOW,
    })
    expect(elsewhere.entries()).toEqual([])
  })

  it('anchors click goals found in the page or the chrome', () => {
    const clickTest = experiment({
      goal: { type: 'CLICK', nodeId: 'cta' },
    })
    const plan = planExperiments({
      snapshot: { pages: [home] },
      page: home,
      experiments: [clickTest],
      visitorKey: keyFor('A'),
      now: NOW,
    })
    // Goal not rendered yet: exposure only.
    const header: CanvasDocument = {
      ...createSiteDocument(),
      nodes: {
        ...createSiteDocument().nodes,
        cta: {
          id: 'cta',
          type: 'site.button',
          props: { label: 'Fale conosco' },
        },
      },
    }
    header.nodes.s1 = { ...header.nodes.s1, children: ['h1', 'cta'] }
    const chrome = plan.chrome(header)
    expect(chrome.nodes.cta.props.anchor).toBe('ss-goal-cta')
    expect(plan.entries()).toEqual([
      { id: 'exp1', x: true, g: { t: 'click', a: 'ss-goal-cta' } },
    ])

    const otherPage = page('sobre', testDoc())
    const away = planExperiments({
      snapshot: { pages: [home, otherPage] },
      page: otherPage,
      experiments: [clickTest],
      visitorKey: keyFor('A'),
      now: NOW,
    })
    expect(away.entries()).toEqual([])
  })

  it('does not expose a section test whose section left the page', () => {
    const withoutControl = page('home', createSiteDocument())
    const plan = planExperiments({
      snapshot: { pages: [home] },
      page: withoutControl,
      experiments: [experiment({ controlNodeId: 'zz' })],
      visitorKey: 'k',
      now: NOW,
    })
    expect(plan.entries()).toEqual([{ id: 'exp1', x: false, g: { t: 'form' } }])
  })
})
