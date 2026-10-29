import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  emailBlock,
  emailDocument,
  renderEditing,
} from '@/src/__tests__/helpers/email-canvas'
import { getNode } from '@/src/lib/canvas/nodes'
import {
  applyOp,
  canDrop,
  createDocument,
  fragmentForType,
  validateDocument,
} from '@/src/lib/canvas/ops'
import { getIn } from '@/src/lib/canvas/path'
import type { InspectorField } from '@/src/lib/canvas/registry'
import type { CanvasNode } from '@/src/lib/canvas/types'
import {
  createEmailCatalog,
  EMAIL_BLOCK_TYPES,
  EMAIL_CATALOG_ID,
  EMAIL_CATALOG_VERSION,
  EMAIL_CATEGORIES,
  emailCatalog,
  emailDependencies,
} from '@/src/lib/canvas-email/catalog'
import { columnWidths } from '@/src/lib/canvas-email/components/layout'
import {
  createEmailRenderContext,
  DEFAULT_EMAIL_BRAND,
  EMAIL_FONTS,
  EMAIL_TYPOGRAPHY_FONTS,
  emailColor,
  emailColorTokens,
  emailFont,
  googleFontHref,
} from '@/src/lib/canvas-email/theme'

const definitions = Object.values(emailCatalog.components)

function fieldsOf(field: InspectorField): InspectorField[] {
  return [field]
}

describe('e-mail catalog', () => {
  it('is the email catalog, version 2, rooted at email.body', () => {
    expect(emailCatalog.id).toBe(EMAIL_CATALOG_ID)
    expect(emailCatalog.id).toBe('email')
    expect(emailCatalog.version).toBe(EMAIL_CATALOG_VERSION)
    expect(emailCatalog.version).toBe(2)
    expect(emailCatalog.rootType).toBe('email.body')
    expect(emailCatalog.breakpoints).toEqual(['base', 'mobile'])
    expect(emailCatalog.categories).toEqual([...EMAIL_CATEGORIES])
  })

  it('registers every block the brief lists', () => {
    expect(EMAIL_BLOCK_TYPES.sort()).toEqual(
      [
        'email.heading',
        'email.text',
        'email.button',
        'email.image',
        'email.divider',
        'email.spacer',
        'email.list',
        'email.logo',
        'email.social',
        'email.menu',
        'email.signature',
        'email.product',
        'email.coupon',
        'email.quote',
        'email.nps',
        'email.event',
        'email.video',
        'email.html',
        'email.posts',
      ].sort(),
    )
  })

  it.each(definitions.map((d) => [d.type, d] as const))(
    '%s: default props pass its schema, icon and inspector paths exist',
    (_type, definition) => {
      const props = definition.defaultProps()
      expect(definition.propsSchema.safeParse(props).success).toBe(true)
      expect(emailCatalog.icons?.[definition.icon]).toBeDefined()
      if (definition.category) {
        expect(EMAIL_CATEGORIES).toContain(definition.category)
      }
      for (const section of definition.inspector) {
        for (const field of section.fields.flatMap(fieldsOf)) {
          const shape = (
            definition.propsSchema as unknown as {
              shape: Record<string, unknown>
            }
          ).shape
          expect(
            Object.keys(shape),
            `${definition.type}: ${field.path}`,
          ).toContain(field.path.split('.')[0])
        }
      }
      if (definition.inlineText) {
        expect(typeof getIn(props, definition.inlineText.path)).toBe('string')
      }
    },
  )

  it('creates a valid empty document (root + required footer)', () => {
    const doc = createDocument(emailCatalog)
    expect(doc.catalog).toBe('email')
    const result = validateDocument(doc, emailCatalog)
    // The engine requires the footer; the root template has no children.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.map((e) => e.code)).toEqual(
        expect.arrayContaining(['REQUIRED', 'MIN_CHILDREN']),
      )
    }
  })

  it('validates a full document with every block', () => {
    const doc = emailDocument([[EMAIL_BLOCK_TYPES.map((type) => ({ type }))]])
    expect(validateDocument(doc, emailCatalog).ok).toBe(true)
  })

  it('enforces the structure: blocks only in columns, 1–4 columns, one footer', () => {
    const doc = emailDocument()
    expect(canDrop(doc, emailCatalog, 'email.text', 'root')).toBe(false)
    expect(canDrop(doc, emailCatalog, 'email.text', 's0c0')).toBe(true)
    expect(canDrop(doc, emailCatalog, 'email.column', 's0')).toBe(true)
    expect(canDrop(doc, emailCatalog, 'email.section', 'root')).toBe(true)
    expect(canDrop(doc, emailCatalog, 'email.section', 's0c0')).toBe(false)

    const footer = fragmentForType(emailCatalog, 'email.footer')
    if (!footer) throw new Error('missing footer')
    const insert = applyOp(
      doc,
      { kind: 'insert', fragment: footer, at: { parentId: 'root', index: 0 } },
      emailCatalog,
    )
    expect(!insert.ok && insert.error.code).toBe('UNIQUE')

    const remove = applyOp(doc, { kind: 'remove', id: 'footer' }, emailCatalog)
    expect(!remove.ok && remove.error.code).toBe('REQUIRED')

    const five = emailDocument([[[], [], [], [], []]])
    const result = validateDocument(five, emailCatalog)
    expect(!result.ok && result.error.map((e) => e.code)).toContain(
      'MAX_CHILDREN',
    )
  })

  it('the section palette item inserts a section with one column', () => {
    const fragment = fragmentForType(emailCatalog, 'email.section')
    if (!fragment) throw new Error('missing section')
    const root = fragment.nodes[fragment.rootId]
    expect(root.type).toBe('email.section')
    expect(root.children).toHaveLength(1)
    expect(fragment.nodes[root.children?.[0] as string].type).toBe(
      'email.column',
    )
  })

  it('hides the HTML block from the palette of non-admins only', () => {
    const member = createEmailCatalog({ allowHtml: false })
    expect(member.components['email.html'].category).toBeUndefined()
    expect(emailCatalog.components['email.html'].category).toBe('Avançado')
    const doc = emailDocument([[[{ type: 'email.html' }]]])
    expect(validateDocument(doc, member).ok).toBe(true)
  })
})

describe('theme', () => {
  it('derives the color tokens from the brand', () => {
    const tokens = emailColorTokens({
      ...DEFAULT_EMAIL_BRAND,
      primaryColor: '#000000',
    })
    expect(emailColor('token:primary', tokens)).toBe('#000000')
    expect(emailColor('token:on-primary', tokens)).toBe('#FFFFFF')
    expect(emailColor('token:nope', tokens)).toBeUndefined()
    expect(emailColor('#123456', tokens)).toBe('#123456')
    expect(emailColor(undefined, tokens)).toBeUndefined()
    expect(
      emailColorTokens({ ...DEFAULT_EMAIL_BRAND, primaryColor: '' })[0].value,
    ).toBe('#2893CC')
  })

  it('offers safe and Google fonts with fallbacks', () => {
    expect(emailFont('inter').stack).toContain('Arial')
    expect(emailFont('unknown').id).toBe('system')
    expect(googleFontHref(emailFont('inter'))).toContain(
      'fonts.googleapis.com/css2?family=Inter',
    )
    expect(googleFontHref(emailFont('arial'))).toBeNull()
    expect(EMAIL_TYPOGRAPHY_FONTS).toHaveLength(EMAIL_FONTS.length)
  })

  it('builds a default render context', () => {
    const ctx = createEmailRenderContext()
    expect(ctx.brand).toBe(DEFAULT_EMAIL_BRAND)
    expect(ctx.products).toEqual({})
    expect(ctx.mobileCss).toBe('')
    expect(ctx.doc).toBeUndefined()
  })
})

describe('column widths', () => {
  it('splits auto columns equally and normalizes to 100', () => {
    expect(columnWidths([])).toEqual([])
    expect(columnWidths([null, null])).toEqual([50, 50])
    expect(columnWidths([30, null, null])).toEqual([30, 35, 35])
    expect(columnWidths([60, 60])).toEqual([50, 50])
    expect(columnWidths([100, null])).toEqual([100, 0])
  })
})

describe('editing render (the canvas the shell shows)', () => {
  it('marks every node with data-canvas-id and shows hints', () => {
    const doc = emailDocument([
      [
        [],
        [
          { type: 'email.image' },
          { type: 'email.coupon', props: { code: '' } },
        ],
      ],
    ])
    const html = renderEditing(doc)
    for (const id of ['root', 's0', 's0c0', 's0c1', 'b0', 'b1', 'footer']) {
      expect(html).toContain(`data-canvas-id="${id}"`)
    }
    expect(html).toContain('Arraste blocos para esta coluna')
    expect(html).toContain('Escolha uma imagem')
    expect(html).toContain('Informe o código do cupom')
    expect(html).not.toContain('<html')
  })

  it('shows placeholders for empty texts', () => {
    const doc = emailDocument([
      [
        [
          { type: 'email.heading', props: { text: '' } },
          { type: 'email.text', props: { html: '' } },
          { type: 'email.button', props: { label: '' } },
          { type: 'email.quote', props: { text: '' } },
          {
            type: 'email.signature',
            props: { closing: '', name: '', role: '', contact: '' },
          },
          { type: 'email.product' },
          { type: 'email.video' },
          { type: 'email.html', props: { html: '' } },
        ],
      ],
    ])
    const html = renderEditing(doc)
    expect(html).toContain('Título')
    expect(html).toContain('Escreva o seu texto')
    expect(html).toContain('Texto do botão')
    expect(html).toContain('Escreva o depoimento')
    expect(html).toContain('Preencha a assinatura')
    expect(html).toContain('Escolha um produto do CRM')
    expect(html).toContain('Escolha a imagem de capa do vídeo')
    expect(html).toContain('Cole o seu HTML')
  })

  it('resolves mobile values inline on the mobile breakpoint', () => {
    const doc = emailDocument(
      [
        [
          [
            {
              type: 'email.heading',
              props: {
                align: { base: 'left', mobile: 'center' },
                padding: {
                  base: { top: 8, right: 0, bottom: 8, left: 0 },
                  mobile: { top: 2, right: 0, bottom: 2, left: 0 },
                },
                typography: {
                  base: { fontSize: 30 },
                  mobile: { fontSize: 18 },
                },
              },
            },
            {
              type: 'email.spacer',
              props: { height: { base: 40, mobile: 10 } },
            },
          ],
          [],
        ],
      ],
      { root: { fontFamily: 'inter' } },
    )
    const desktop = renderEditing(doc)
    expect(desktop).toContain('font-size:30px')
    expect(desktop).toContain('height:40px')
    expect(desktop).toContain('fonts.googleapis.com')
    const mobile = renderEditing(doc, { breakpoint: 'mobile' })
    expect(mobile).toContain('text-align:center')
    expect(mobile).toContain('font-size:18px')
    expect(mobile).toContain('padding:2px 0px 2px 0px')
    expect(mobile).toContain('height:10px')
    // Stacked columns on the phone preview.
    expect(mobile).toMatch(/width:100%;display:block/)
  })

  it('fades blocks hidden on the current device instead of dropping them', () => {
    const doc = emailDocument([
      [
        [
          {
            type: 'email.text',
            props: { visibility: { base: true, tablet: true, mobile: false } },
          },
        ],
      ],
    ])
    expect(renderEditing(doc)).not.toContain('opacity:0.35')
    expect(renderEditing(doc, { breakpoint: 'mobile' })).toContain(
      'opacity:0.35',
    )
  })

  it('renders without a document reader (widths fall back)', () => {
    const doc = emailDocument([[[{ type: 'email.text' }], []]], {
      column: { width: 30 },
    })
    expect(renderEditing(doc, { context: { doc: undefined } })).toContain(
      'width:',
    )
  })

  it('every block renders on its own (default props)', () => {
    for (const type of EMAIL_BLOCK_TYPES) {
      const doc = emailDocument([[[{ type }]]])
      expect(renderEditing(doc)).toContain('data-canvas-id="b0"')
    }
    expect(emailBlock({ type: 'email.text' }).props).toHaveProperty('html')
  })
})

describe('editor attributes (shell contract)', () => {
  it.each(definitions.map((d) => [d.type, d] as const))(
    '%s spreads attributes on its outermost element, only when editing',
    (_type, definition) => {
      const node = {
        id: 'n1',
        type: definition.type,
        props: definition.defaultProps(),
        ...(definition.accepts === false ? {} : { children: [] }),
      }
      const editing = renderToStaticMarkup(
        definition.render({
          node,
          breakpoint: 'base',
          editing: true,
          attributes: { 'data-canvas-id': 'n1' },
        }) as ReactElement,
      )
      expect(editing).toMatch(/^<[a-z]+[^>]*\sdata-canvas-id="n1"/)
      const output = renderToStaticMarkup(
        definition.render({
          node,
          breakpoint: 'base',
          editing: false,
        }) as ReactElement,
      )
      expect(output).not.toContain('data-canvas-id')
    },
  )
})

describe('render dependencies (editor redraws)', () => {
  const doc = emailDocument([[[{ type: 'email.text' }], [], []]])
  const deps = (d: typeof doc, id: string) =>
    emailDependencies(d, getNode(d, id) as CanvasNode)

  it('blocks and sections depend on the body props only', () => {
    expect(deps(doc, 'b0')).toEqual([doc.nodes.root.props])
    expect(deps(doc, 's0')).toEqual([doc.nodes.root.props])
    expect(emailCatalog.components['email.text'].dependsOn).toBe(
      emailDependencies,
    )
    expect(emailCatalog.components['email.body'].dependsOn).toBeUndefined()
  })

  it('a column depends on the widths of all its siblings', () => {
    const before = deps(doc, 's0c1')
    expect(before).toEqual([doc.nodes.root.props, 3, null, null, null])
    const resized = applyOp(
      doc,
      { kind: 'update', id: 's0c0', set: { width: 50 } },
      emailCatalog,
    )
    if (!resized.ok) throw new Error('update refused')
    const after = deps(resized.value.doc, 's0c1')
    expect(after).toEqual([doc.nodes.root.props, 3, 50, null, null])
    // The sibling's render really changes with it: 50% + 25% + 25%.
    const html = renderEditing(resized.value.doc)
    expect(html).toMatch(/data-canvas-id="s0c1"[^>]*width="25%"/)
  })

  it('a detached column depends on the body alone', () => {
    const orphan = { id: 'x', type: 'email.column', props: {}, children: [] }
    expect(emailDependencies(doc, orphan)).toEqual([doc.nodes.root.props, 0])
  })
})
