import { describe, expect, it } from 'vitest'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import { SITE_KITS, type SiteKitId } from '@/src/lib/canvas-site/presets/kits'
import {
  anchorsOf,
  buildGlobalDocuments,
  buildPageDocument,
  buildSectionFragment,
  fixLinks,
  keepValidSections,
  replaceSampleBrand,
} from '@/src/lib/site-ai/assemble'
import {
  type SectionContext,
  SITE_AI_SECTIONS,
} from '@/src/lib/site-ai/sections'
import { applySlots, collectSlots } from '@/src/lib/site-ai/slots'
import { validateSiteDocument } from '@/src/lib/sites/document'

function context(
  kit: SiteKitId,
  overrides: Partial<SectionContext> = {},
): SectionContext {
  return {
    kit: SITE_KITS[kit],
    companyName: 'Padaria Pão & Cia',
    logoUrl: null,
    ctaLabel: 'Fale com a gente',
    contactLink: { type: 'page', value: 'page-contact' },
    products: [
      {
        name: 'Pão de fermentação natural',
        description: 'Feito <na hora>',
        price: 'R$ 18,00',
      },
      { name: 'Bolo', description: '', price: 'R$ 45,00' },
    ],
    testimonials: [
      { quote: 'Melhor pão & café', name: 'Ana', role: 'Cliente' },
      { quote: 'Atendimento ótimo', name: 'João', role: '' },
    ],
    form: {
      formToken: 'tok_123',
      formName: 'Contato',
      fields: [{ key: 'nome', label: 'Nome', type: 'text', required: true }],
    },
    eventDate: '2026-12-01',
    pageTitle: 'Sobre',
    ...overrides,
  }
}

const KITS: SiteKitId[] = ['agency', 'b2b', 'saas']

describe('every AI section in every kit', () => {
  it.each(KITS)('builds a valid page with all sections (%s)', (kit) => {
    const doc = buildPageDocument([...SITE_AI_SECTIONS], context(kit))
    const slots = collectSlots(doc)
    const values = new Map(slots.map((slot) => [slot.id, `Texto ${slot.id}`]))
    Object.assign(doc.nodes, applySlots(doc.nodes, slots, values).nodes)
    fixLinks(doc.nodes, { type: 'page', value: 'p1' })
    const checked = keepValidSections(doc)
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.value.dropped).toEqual([])
    expect(
      (checked.value.doc.nodes[checked.value.doc.rootId].children ?? []).length,
    ).toBe(SITE_AI_SECTIONS.length)
  })

  it.each(KITS)('builds valid header and footer globals (%s)', (kit) => {
    const { header, footer } = buildGlobalDocuments(
      context(kit),
      'Pão fresco <todo dia>',
    )
    expect(validateSiteDocument(header).ok).toBe(true)
    expect(validateSiteDocument(footer).ok).toBe(true)
    const menus = Object.values(header.nodes).filter(
      (node) => node.type === SITE_TYPES.menu,
    )
    expect(menus[0].props.source).toBe('pages')
    const texts = Object.values(footer.nodes)
      .map((node) => node.props.html)
      .filter(Boolean)
    expect(texts).toContain('<p>Pão fresco &lt;todo dia&gt;</p>')
  })

  it('uses an image logo when the brand has one', () => {
    const { header } = buildGlobalDocuments(
      context('agency', { logoUrl: 'https://cdn.example.com/logo.png' }),
      'x',
    )
    expect(validateSiteDocument(header).ok).toBe(true)
    const logo = Object.values(header.nodes).find(
      (node) => node.meta?.name === 'Logo',
    ) as CanvasNode
    expect(logo.type).toBe(SITE_TYPES.image)
    expect(logo.props.image).toEqual({
      src: 'https://cdn.example.com/logo.png',
      alt: 'Padaria Pão & Cia',
    })
  })

  it('keeps real data out of the slots and escapes it', () => {
    const doc = buildPageDocument(['products', 'testimonials'], context('b2b'))
    const slots = collectSlots(doc)
    const current = slots.map((slot) => slot.current).join(' ')
    expect(current).not.toContain('R$ 18,00')
    expect(current).not.toContain('Melhor pão')
    const html = Object.values(doc.nodes)
      .map((node) => node.props.html)
      .join(' ')
    expect(html).toContain('Feito &lt;na hora&gt;')
    expect(html).toContain('“Melhor pão &amp; café”')
    expect(html).toContain('<strong>João</strong></p>')
  })

  it('fills the form and the countdown, and empties them without data', () => {
    const withData = buildPageDocument(
      ['contact', 'countdown'],
      context('saas'),
    )
    const nodes = Object.values(withData.nodes)
    const form = nodes.find(
      (node) => node.type === SITE_TYPES.form,
    ) as CanvasNode
    expect(form.props.formToken).toBe('tok_123')
    const countdown = nodes.find(
      (node) => node.type === SITE_TYPES.countdown,
    ) as CanvasNode
    expect(countdown.props.date).toBe('2026-12-01')

    const empty = buildPageDocument(
      ['contact', 'countdown'],
      context('saas', { form: null, eventDate: null }),
    )
    expect(validateSiteDocument(empty).ok).toBe(true)
    const emptyForm = Object.values(empty.nodes).find(
      (node) => node.type === SITE_TYPES.form,
    ) as CanvasNode
    expect(emptyForm.props).toMatchObject({ formToken: '', fields: [] })
  })

  it('builds a one-section fragment', () => {
    const fragment = buildSectionFragment('services', context('agency'))
    expect(fragment.nodes[fragment.rootId].type).toBe(SITE_TYPES.section)
  })
})

describe('fixLinks', () => {
  it('sends unknown anchors to the fallback, keeping the real ones', () => {
    const nodes: Record<string, CanvasNode> = {
      s: {
        id: 's',
        type: SITE_TYPES.section,
        props: { anchor: 'servicos' },
      },
      a: {
        id: 'a',
        type: SITE_TYPES.button,
        props: { link: { type: 'anchor', value: '#servicos' } },
      },
      b: {
        id: 'b',
        type: SITE_TYPES.button,
        props: { link: { type: 'anchor', value: 'planos' } },
      },
      c: {
        id: 'c',
        type: SITE_TYPES.button,
        props: { link: { type: 'url', value: 'https://x.com' } },
      },
      d: {
        id: 'd',
        type: SITE_TYPES.pricing,
        props: {
          plans: [{ link: { type: 'anchor', value: 'contato' } }, 'odd'],
          items: 'not a list',
        },
      },
    }
    expect(anchorsOf(nodes)).toEqual(new Set(['servicos']))
    const fixed = fixLinks(nodes, { type: 'page', value: 'p9' })
    expect(fixed).toBe(2)
    expect(nodes.a.props.link).toEqual({ type: 'anchor', value: '#servicos' })
    expect(nodes.b.props.link).toEqual({ type: 'page', value: 'p9' })
    expect(nodes.c.props.link).toEqual({ type: 'url', value: 'https://x.com' })
    expect((nodes.d.props.plans as unknown[])[0]).toEqual({
      link: { type: 'page', value: 'p9' },
    })
    expect((nodes.d.props.plans as unknown[])[1]).toBe('odd')
  })
})

describe('replaceSampleBrand', () => {
  it('swaps the sample brand in headings, texts and buttons only', () => {
    const nodes: Record<string, CanvasNode> = {
      h: {
        id: 'h',
        type: SITE_TYPES.heading,
        props: { text: 'Cresça com a Aurora.' },
      },
      t: { id: 't', type: SITE_TYPES.text, props: { html: '<p>Aurora</p>' } },
      b: { id: 'b', type: SITE_TYPES.button, props: { label: 'Aurora já' } },
      i: {
        id: 'i',
        type: SITE_TYPES.image,
        props: { image: { alt: 'Aurora' } },
      },
      x: { id: 'x', type: SITE_TYPES.heading, props: { text: 5 } },
    }
    replaceSampleBrand(nodes, 'Pão & Cia')
    expect(nodes.h.props.text).toBe('Cresça com a Pão & Cia.')
    expect(nodes.t.props.html).toBe('<p>Pão & Cia</p>')
    expect(nodes.b.props.label).toBe('Pão & Cia já')
    expect(nodes.i.props.image).toEqual({ alt: 'Aurora' })
    expect(nodes.x.props.text).toBe(5)
  })
})

describe('keepValidSections', () => {
  it('drops a section that fails the catalog and keeps the rest', () => {
    const doc = buildPageDocument(['hero', 'cta'], context('agency'))
    const [hero] = doc.nodes[doc.rootId].children as string[]
    const broken: CanvasDocument = structuredClone(doc)
    const heading = Object.values(broken.nodes).find(
      (node) => node.type === SITE_TYPES.heading,
    ) as CanvasNode
    heading.props.level = 'h9'
    const checked = keepValidSections(broken)
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.value.dropped).toEqual([doc.nodes[hero].meta?.name])
    expect(checked.value.doc.nodes[hero]).toBeUndefined()
  })

  it('names an unnamed dropped section by id and fails a broken root', () => {
    const doc = buildPageDocument(['cta'], context('agency'))
    const [cta] = doc.nodes[doc.rootId].children as string[]
    doc.nodes[cta].meta = undefined
    doc.nodes[cta].props.padding = 'bad'
    const checked = keepValidSections(doc)
    expect(checked.ok && checked.value.dropped).toEqual([cta])

    const root = buildPageDocument([], context('agency'))
    root.nodes[root.rootId].props.background = 'bad'
    expect(keepValidSections(root).ok).toBe(false)
  })
})
