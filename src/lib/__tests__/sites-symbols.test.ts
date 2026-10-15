import { describe, expect, it } from 'vitest'
import { nodeOfType } from '@/src/__tests__/helpers/site-canvas'
import { getNode } from '@/src/lib/canvas/nodes'
import { SITE_SYMBOL_TYPE, validateSiteDocument } from '@/src/lib/canvas-site'
import {
  heading,
  section,
  spec,
  toDocument,
} from '@/src/lib/canvas-site/presets/builder'
import {
  hasSymbolInstances,
  plainToRichText,
  richTextToPlain,
  symbolDocumentFrom,
  symbolInstanceFragment,
  symbolSourceOf,
} from '@/src/lib/sites/symbols'

const page = toDocument([
  section({ anchor: 'cta' }, [heading('h2', 'Fale com a gente')]),
  section({}, [heading('h2', 'Outra')]),
])
const cta = page.nodes.root.children?.[0] as string

describe('reusable component helpers', () => {
  it('accepts exactly one selected section as a source', () => {
    expect(symbolSourceOf(page, [cta])).toBe(cta)
    expect(symbolSourceOf(page, [])).toBeNull()
    expect(symbolSourceOf(page, [cta, 'x'])).toBeNull()
    expect(symbolSourceOf(page, [nodeOfType(page, 'site.heading').id])).toBe(
      null,
    )
    expect(symbolSourceOf(page, ['ghost'])).toBeNull()
  })

  it('copies the section into a valid master document with fresh ids', () => {
    const master = symbolDocumentFrom(page, cta)
    expect(validateSiteDocument(master).ok).toBe(true)
    const root = getNode(master, master.rootId)
    expect(root?.children).toHaveLength(1)
    const copy = getNode(master, root?.children?.[0] as string)
    expect(copy?.type).toBe('site.section')
    expect(copy?.id).not.toBe(cta)
    expect(copy?.props.anchor).toBe('cta')
  })

  it('builds a lone instance and detects instances', () => {
    const fragment = symbolInstanceFragment('sym1')
    expect(fragment.nodes[fragment.rootId]).toMatchObject({
      type: SITE_SYMBOL_TYPE,
      props: { symbolId: 'sym1', overrides: {} },
    })
    expect(hasSymbolInstances(page)).toBe(false)
    expect(
      hasSymbolInstances(
        toDocument([spec(SITE_SYMBOL_TYPE, { symbolId: 'sym1' })]),
      ),
    ).toBe(true)
  })

  it('converts rich text to plain text and back', () => {
    expect(
      richTextToPlain(
        '<p>Olá <strong>mundo</strong></p><p>a&amp;b &lt;x&gt; &quot;q&quot; &#39;s&#39;&nbsp;fim<br/>linha</p>',
      ),
    ).toBe('Olá mundo\na&b <x> "q" \'s\' fim\nlinha')
    expect(plainToRichText('Linha 1\n\n Linha <2> \n')).toBe(
      '<p>Linha 1</p><p>Linha &lt;2&gt;</p>',
    )
    expect(plainToRichText('"a" & b')).toBe('<p>&quot;a&quot; &amp; b</p>')
  })
})
