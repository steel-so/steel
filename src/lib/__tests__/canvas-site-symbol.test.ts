import { describe, expect, it } from 'vitest'
import {
  nodeOfType,
  renderSite,
  renderSiteEditing,
} from '@/src/__tests__/helpers/site-canvas'
import {
  applySymbolOverrides,
  compileSiteCss,
  createSiteCatalog,
  SITE_SYMBOL_TYPE,
  siteCatalog,
  symbolTextNodes,
  usedSymbolIds,
  validateSiteDocument,
} from '@/src/lib/canvas-site'
import {
  button,
  heading,
  section,
  spec,
  text,
  toDocument,
} from '@/src/lib/canvas-site/presets/builder'

const master = toDocument([
  section({ anchor: 'cta' }, [
    heading('h2', 'Fale com a gente'),
    text('<p>Atendimento 24h</p>'),
    button('Agendar', { type: 'url', value: '/contato' }),
  ]),
])

const instance = (props: Record<string, unknown>) =>
  toDocument([
    spec(SITE_TYPES_SYMBOL, { symbolId: 'sym1', ...props }),
    section({}, [heading('h2', 'Depois')]),
  ])

const SITE_TYPES_SYMBOL = SITE_SYMBOL_TYPE

describe('site.symbol (reusable component instance)', () => {
  it('validates as a page child only', () => {
    expect(validateSiteDocument(instance({})).ok).toBe(true)
    const nested = toDocument([
      section({}, [spec(SITE_SYMBOL_TYPE, { symbolId: 'sym1' })]),
    ])
    expect(validateSiteDocument(nested).ok).toBe(false)
  })

  it('renders the master content, with text overrides', () => {
    const headingId = nodeOfType(master, 'site.heading').id
    const buttonId = nodeOfType(master, 'site.button').id
    const html = renderSite(
      instance({
        overrides: { [headingId]: 'Fale com a clínica', [buttonId]: 'Marcar' },
      }),
      { symbols: { sym1: master } },
    )
    expect(html).toContain('class="s-symbol"')
    expect(html).toContain('Fale com a clínica')
    expect(html).toContain('Marcar')
    expect(html).toContain('Atendimento 24h')
    expect(html).not.toContain('Fale com a gente')
    expect(html).not.toContain('data-symbol')
    expect(html.indexOf('Fale com a clínica')).toBeLessThan(
      html.indexOf('Depois'),
    )
  })

  it('renders nothing for a missing symbol (a hint on the canvas)', () => {
    expect(renderSite(instance({}), {})).not.toContain('s-symbol')
    const editing = renderSiteEditing(instance({}), {})
    expect(editing).toContain('Componente reutilizável removido')
  })

  it('marks the instance on the canvas and never nests a symbol in itself', () => {
    const editing = renderSiteEditing(instance({}), {
      symbols: { sym1: master },
    })
    expect(editing).toContain('data-symbol="sym1"')
    // The instance carries the canvas id; its inner nodes do not.
    expect(editing.match(/data-canvas-id/g)?.length).toBeGreaterThan(1)
    const selfRef = toDocument([spec(SITE_SYMBOL_TYPE, { symbolId: 'sym1' })])
    const html = renderSite(instance({}), { symbols: { sym1: selfRef } })
    expect(html).toContain('class="s-symbol"')
    expect(html.match(/s-symbol/g)).toHaveLength(1)
  })

  it('applies overrides only to texts of nodes that still exist', () => {
    const headingId = nodeOfType(master, 'site.heading').id
    const sectionId = nodeOfType(master, 'site.section').id
    expect(applySymbolOverrides(master, undefined, siteCatalog)).toBe(master)
    const doc = applySymbolOverrides(
      master,
      { [headingId]: 'Novo', [sectionId]: 'x', ghost: 'y' },
      siteCatalog,
    )
    expect(doc.nodes[headingId].props.text).toBe('Novo')
    expect(doc.nodes[sectionId]).toBe(master.nodes[sectionId])
    expect(doc.nodes.ghost).toBeUndefined()
  })

  it('lists the overridable texts and the symbols in use', () => {
    const texts = symbolTextNodes(master, siteCatalog)
    expect(texts.map((item) => [item.type, item.rich, item.value])).toEqual([
      ['site.heading', false, 'Fale com a gente'],
      ['site.text', true, '<p>Atendimento 24h</p>'],
      ['site.button', false, 'Agendar'],
    ])
    const hidden = {
      ...master,
      nodes: {
        ...master.nodes,
        [texts[0].id]: { ...master.nodes[texts[0].id], meta: { hidden: true } },
      },
    }
    expect(symbolTextNodes(hidden, siteCatalog)).toHaveLength(2)

    const doc = instance({})
    const hiddenInstance = toDocument([
      { ...spec(SITE_SYMBOL_TYPE, { symbolId: 'sym2' }) },
      spec(SITE_SYMBOL_TYPE, { symbolId: '' }),
    ])
    const sym2 = nodeOfType(hiddenInstance, SITE_SYMBOL_TYPE)
    hiddenInstance.nodes[sym2.id] = { ...sym2, meta: { hidden: true } }
    expect(usedSymbolIds([doc, hiddenInstance, master])).toEqual(['sym1'])
  })

  it('compiles the CSS of the symbol documents passed along', () => {
    const css = compileSiteCss([instance({}), master])
    expect(css).toContain('.s-')
    expect(createSiteCatalog({}).components['site.page'].accepts).toContain(
      SITE_SYMBOL_TYPE,
    )
  })
})
