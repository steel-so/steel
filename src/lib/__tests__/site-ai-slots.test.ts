import { describe, expect, it } from 'vitest'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  button,
  form,
  heading,
  image,
  list,
  named,
  section,
  spec,
  text,
  toDocument,
  toFragment,
} from '@/src/lib/canvas-site/presets/builder'
import {
  applySlots,
  collectSlots,
  escapeHtml,
  fitSlotText,
  htmlToText,
  isVisualSlot,
  type TextSlot,
  textToHtml,
} from '@/src/lib/site-ai/slots'

function sample(): CanvasDocument {
  return toDocument([
    named(
      'Destaque',
      section({}, [
        heading('h1', 'Título de exemplo'),
        text('<p>Primeiro parágrafo</p><p>Segundo &amp; final</p>'),
        text('Sobre', { preset: 'overline' }),
        button('Clique', { type: 'anchor', value: 'contato' }),
        list(['Um', 'Dois']),
        image('/x.png', 'Foto antiga', { caption: 'Legenda' }),
        image('/y.png', 'Sem legenda'),
        spec(SITE_TYPES.icon, { name: 'star' }),
        named('Logo', text('<p><strong>Aurora</strong></p>')),
      ]),
    ),
    named(
      'Mais',
      section({}, [
        spec(SITE_TYPES.accordion, {}, [
          spec(SITE_TYPES.accordionItem, { title: 'Pergunta?' }, [
            text('Resposta'),
          ]),
        ]),
        spec(SITE_TYPES.tabs, {}, [
          spec(SITE_TYPES.tab, { label: 'Aba 1' }, [text('Conteúdo')]),
        ]),
        form({ submitLabel: 'Enviar', successMessage: 'Ok' }),
        spec(SITE_TYPES.countdown, { expiredText: 'Acabou' }),
        spec(SITE_TYPES.pricing, {
          plans: [
            {
              name: 'Básico',
              price: 'R$ 10',
              period: '/mês',
              description: 'Para começar',
              features: 'Um\nDois',
              badge: 'Popular',
              buttonLabel: 'Assinar',
              link: { type: 'anchor', value: 'contato' },
            },
            {
              name: 'Pro',
              price: 'R$ 20',
              features: 'Tudo',
              buttonLabel: 'Assinar',
              link: { type: 'anchor', value: 'contato' },
            },
          ],
        }),
        { ...text('Oculto'), name: undefined },
      ]),
    ),
  ])
}

describe('htmlToText / textToHtml / escapeHtml', () => {
  it('turns rich text into paragraphs of plain text', () => {
    expect(
      htmlToText('<p>Olá <strong>mundo</strong></p><p>a&nbsp;b<br>c &lt;3</p>'),
    ).toBe('Olá mundo\n\na b\nc <3')
    expect(htmlToText('<ul><li>um</li><li>dois</li></ul>')).toBe('um\n\ndois')
  })

  it('escapes and wraps paragraphs', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;',
    )
    expect(textToHtml('Um <b>\nlinha\n\n  \n\nDois')).toBe(
      '<p>Um &lt;b&gt;<br>linha</p><p>Dois</p>',
    )
  })
})

describe('collectSlots', () => {
  it('lists every copy field in reading order with its section', () => {
    const slots = collectSlots(sample())
    const roles = slots.map((slot) => slot.role)
    expect(roles).toEqual([
      'Título h1',
      'Parágrafo',
      'Sobretítulo (curto)',
      'Botão',
      'Item de lista',
      'Item de lista',
      'Texto alternativo da imagem',
      'Legenda da imagem',
      'Texto alternativo da imagem',
      'Ícone',
      'Pergunta',
      'Parágrafo',
      'Nome da aba',
      'Parágrafo',
      'Botão do formulário',
      'Mensagem após o envio',
      'Texto depois do prazo',
      'Plano: nome',
      'Plano: preço',
      'Plano: período',
      'Plano: descrição',
      'Plano: recursos (um por linha)',
      'Plano: selo',
      'Plano: botão',
      'Plano: nome',
      'Plano: preço',
      'Plano: recursos (um por linha)',
      'Plano: botão',
      'Parágrafo',
    ])
    expect(slots[0]).toMatchObject({
      id: 't1',
      section: 'Destaque',
      max: 90,
      current: 'Título de exemplo',
    })
    expect(slots[1]).toMatchObject({
      rich: true,
      multiline: true,
      current: 'Primeiro parágrafo\n\nSegundo & final',
    })
    expect(slots[2]).toMatchObject({ max: 40, multiline: false })
    expect(slots.at(-1)?.section).toBe('Mais')
    // The logo is real data: never a slot.
    expect(slots.some((slot) => slot.current === 'Aurora')).toBe(false)
  })

  it('skips hidden nodes, narrows to a selection and leaves visuals out', () => {
    const doc = sample()
    const root = doc.nodes[doc.rootId]
    const [first, second] = root.children as string[]
    const hiddenId = (doc.nodes[second].children as string[]).at(-1) as string
    doc.nodes[hiddenId].meta = { hidden: true }

    const all = collectSlots(doc)
    expect(all.at(-1)?.role).toBe('Plano: botão')

    const firstOnly = collectSlots(doc, { within: [first], textOnly: true })
    expect(firstOnly.every((slot) => slot.section === 'Destaque')).toBe(true)
    expect(firstOnly.some((slot) => isVisualSlot(slot.path))).toBe(false)
    expect(firstOnly.map((slot) => slot.id)).toEqual(
      firstOnly.map((_, index) => `t${index + 1}`),
    )
  })

  it('labels a fragment by its own section and unknown roots by type', () => {
    const fragment = toFragment(
      named('Seção X', section({}, [heading('h2', 'Oi')])),
    )
    expect(collectSlots(fragment)[0]).toMatchObject({
      section: 'Seção X',
      role: 'Título h2',
      max: 140,
    })
    const unnamed = toFragment(section({}, [text('Oi', { preset: 'small' })]))
    expect(collectSlots(unnamed)[0]).toMatchObject({
      section: 'Seção',
      role: 'Texto pequeno',
    })
    expect(collectSlots({ rootId: 'missing', nodes: {} })).toEqual([])
    const odd = {
      rootId: 'root',
      nodes: {
        root: {
          id: 'root',
          type: SITE_TYPES.page,
          props: {},
          children: ['x'],
        },
        x: { id: 'x', type: 'site.unknown', props: {}, children: ['h'] },
        h: { id: 'h', type: SITE_TYPES.heading, props: { text: 'Oi' } },
      },
    }
    expect(collectSlots(odd)[0].section).toBe('site.unknown')
  })

  it('treats odd props as empty', () => {
    const nodes: Record<string, CanvasNode> = {
      a: {
        id: 'a',
        type: SITE_TYPES.list,
        props: { items: [null, { text: 5 }] },
      },
      b: { id: 'b', type: SITE_TYPES.image, props: {} },
      c: { id: 'c', type: SITE_TYPES.heading, props: { text: 'x' } },
      d: { id: 'd', type: SITE_TYPES.text, props: { preset: 'nope' } },
      e: { id: 'e', type: SITE_TYPES.pricing, props: { plans: 'x' } },
      root: {
        id: 'root',
        type: SITE_TYPES.page,
        props: {},
        children: ['a', 'b', 'c', 'd', 'e'],
      },
    }
    const slots = collectSlots({ rootId: 'root', nodes })
    expect(slots.map((slot) => [slot.role, slot.current])).toEqual([
      ['Item de lista', ''],
      ['Texto alternativo da imagem', ''],
      ['Título h2', 'x'],
      ['Parágrafo', ''],
    ])
  })
})

const slot = (overrides: Partial<TextSlot> = {}): TextSlot => ({
  id: 't1',
  nodeId: 'n1',
  path: ['text'],
  role: 'Título h2',
  current: '',
  max: 20,
  rich: false,
  multiline: false,
  section: '',
  ...overrides,
})

describe('fitSlotText', () => {
  it('cleans quotes, markdown, tags and whitespace', () => {
    expect(fitSlotText('  "**Olá**   <b>mundo</b>"  ', slot())).toBe(
      'Olá mundo',
    )
    expect(fitSlotText('## Título', slot())).toBe('Título')
    expect(fitSlotText('a\n\n\n\nb   c', slot({ multiline: true }))).toBe(
      'a\n\nb c',
    )
  })

  it('caps at a word boundary and rejects empty or non-text values', () => {
    expect(fitSlotText('palavra palavra palavra', slot())).toBe(
      'palavra palavra',
    )
    expect(fitSlotText('abcdefghijklmnopqrstuvwxyz', slot())).toBe(
      'abcdefghijklmnopqrst',
    )
    expect(fitSlotText('Fim de frase, mais', slot({ max: 13 }))).toBe(
      'Fim de frase',
    )
    expect(fitSlotText('   ', slot())).toBeNull()
    expect(fitSlotText(42, slot())).toBeNull()
    expect(fitSlotText(undefined, slot())).toBeNull()
  })
})

describe('applySlots', () => {
  it('writes the values, converts rich text and keeps the input intact', () => {
    const doc = sample()
    const slots = collectSlots(doc)
    const values = new Map(slots.map((item) => [item.id, `Novo ${item.id}`]))
    values.set('t2', 'Linha um\n\nLinha 1 & 2 < 3')
    values.set('t10', 'rocket')
    const result = applySlots(doc.nodes, slots, values)

    const heading = result.nodes[slots[0].nodeId]
    expect(heading.props.text).toBe('Novo t1')
    expect(result.nodes[slots[1].nodeId].props.html).toBe(
      '<p>Linha um</p><p>Linha 1 &amp; 2 &lt; 3</p>',
    )
    const listNode = result.nodes[slots[4].nodeId]
    expect(listNode.props.items).toEqual([
      expect.objectContaining({ text: 'Novo t5' }),
      expect.objectContaining({ text: 'Novo t6' }),
    ])
    expect(result.nodes[slots[9].nodeId].props.name).toBe('rocket')
    expect(result.skipped).toEqual([])
    expect(result.applied).toHaveLength(slots.length)
    // Input untouched.
    expect(doc.nodes[slots[0].nodeId].props.text).toBe('Título de exemplo')
  })

  it('skips missing values and nodes that stop matching their schema', () => {
    const doc = sample()
    const slots = collectSlots(doc)
    const iconSlot = slots.find((item) => item.role === 'Ícone') as TextSlot
    const result = applySlots(
      doc.nodes,
      slots,
      new Map([
        [iconSlot.id, 'not-an-icon'],
        ['t1', 'Só o título'],
      ]),
    )
    expect(result.applied).toEqual(['t1'])
    expect(result.skipped).toContain(iconSlot.id)
    expect(result.nodes[iconSlot.nodeId]).toBeUndefined()
  })

  it('skips a path that does not exist in the props', () => {
    const nodes: Record<string, CanvasNode> = {
      n1: { id: 'n1', type: SITE_TYPES.heading, props: { text: 'a' } },
    }
    const result = applySlots(
      nodes,
      [slot({ path: ['image', 'alt'] })],
      new Map([['t1', 'x']]),
    )
    expect(result).toEqual({ nodes: {}, applied: [], skipped: ['t1'] })
  })
})
