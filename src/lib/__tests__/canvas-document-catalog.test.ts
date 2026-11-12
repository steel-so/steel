import { describe, expect, it } from 'vitest'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  buildDocumentCatalog,
  createDocumentCatalog,
  createEmptyDocumentContent,
  DOCUMENT_SECTION_PRESETS,
  DOCUMENT_STARTERS,
  DOCUMENT_TYPES,
  type DocumentOutline,
  DocumentOutlineSchema,
  describeDocumentError,
  documentFields,
  documentPricingTotals,
  documentSections,
  getDocumentStarter,
  getDocumentStarterOutline,
  outlineToDocument,
  validateDocumentContent,
} from '@/src/lib/canvas-document'
import { videoSource } from '@/src/lib/canvas-document/components/content'
import { columnsTemplate } from '@/src/lib/canvas-document/components/layout'

const FULL_OUTLINE: DocumentOutline = {
  title: 'Proposta completa',
  kind: 'PROPOSAL',
  theme: {
    primaryColor: '#0f766e',
    fontFamily: 'Georgia',
    logoUrl: 'https://cdn.example.com/logo.png',
  },
  sections: [
    {
      name: 'Capa',
      variant: 'cover',
      blocks: [
        { type: 'heading', text: 'Proposta para {{empresa.nome}}' },
        { type: 'text', html: '<p>Olá</p>' },
        { type: 'stats', items: [{ value: '10', label: 'anos' }] },
      ],
    },
    {
      name: 'Conteúdo',
      pageBreakBefore: true,
      variant: 'highlight',
      blocks: [
        { type: 'heading', text: 'Escopo', level: 2 },
        { type: 'list', items: ['a', 'b'], ordered: true },
        { type: 'quote', text: 'Frase', author: 'Autor' },
        { type: 'callout', text: 'Atenção', tone: 'warning' },
        { type: 'table', header: ['A', 'B'], rows: [['1', '2']] },
        { type: 'table', rows: [['sem', 'cabeçalho']] },
        { type: 'image', alt: 'Foto' },
        { type: 'divider' },
        { type: 'page-break' },
        { type: 'button', label: 'Site', href: 'https://example.com' },
        { type: 'video', url: 'https://youtu.be/aqz-KE-bpKQ' },
        {
          type: 'attachments',
          files: [{ name: 'Contrato.pdf', url: 'https://x.dev/c.pdf' }],
        },
        { type: 'validity' },
        { type: 'contact-card' },
        { type: 'toc' },
        {
          type: 'columns',
          columns: [
            [{ type: 'heading', text: 'Esquerda', level: 3 }],
            [{ type: 'text', html: '<p>Direita</p>' }],
            [{ type: 'accept' }],
          ],
        },
      ],
    },
    {
      name: 'Dados',
      blocks: [
        {
          type: 'field',
          fieldType: 'field-text',
          label: 'Nome',
          required: true,
        },
        { type: 'field', fieldType: 'field-cpf', label: 'CPF' },
        { type: 'field', fieldType: 'field-textarea', label: 'Obs.' },
        { type: 'field', fieldType: 'field-email', label: 'E-mail' },
        {
          type: 'field',
          fieldType: 'field-select',
          label: 'Porte',
          options: ['P', 'M'],
          placeholder: 'Escolha',
        },
        {
          type: 'pricing',
          title: 'Investimento',
          items: [
            { id: 'a', name: 'Serviço', unitPrice: 100, quantity: 2 },
            {
              id: 'b',
              name: 'Mensal',
              unitPrice: 50,
              quantity: 1,
              recurrence: 'monthly',
            },
          ],
        },
        { type: 'accept', buttonLabel: 'Aceitar', allowDecline: false },
        { type: 'accept', buttonLabel: 'Segundo aceite' },
      ],
    },
  ],
}

function nodesOfType(doc: CanvasDocument, type: string) {
  return Object.values(doc.nodes).filter((node) => node.type === type)
}

describe('document catalog', () => {
  it('registers exactly the contract types', () => {
    const catalog = createDocumentCatalog()
    const types = Object.keys(catalog.components).sort()
    expect(types).toEqual([...DOCUMENT_TYPES].sort())
    expect(catalog.rootType).toBe('document')
    expect(catalog.breakpoints).toEqual(['base', 'mobile'])
    for (const definition of Object.values(catalog.components)) {
      expect(catalog.icons?.[definition.icon]).toBeDefined()
      const parsed = definition.propsSchema.safeParse(definition.defaultProps())
      expect(parsed.success).toBe(true)
    }
  })

  it('builds a catalog for every render mode', () => {
    for (const mode of ['editor', 'public', 'print'] as const) {
      const catalog = buildDocumentCatalog({ mode })
      expect(catalog.components.section).toBeDefined()
    }
  })

  it('palette templates produce valid fragments', () => {
    const catalog = createDocumentCatalog()
    for (const definition of Object.values(catalog.components)) {
      const fragment = definition.template?.()
      if (!fragment) continue
      const root = fragment.nodes[fragment.rootId]
      expect(root.type).toBe(definition.type)
      for (const node of Object.values(fragment.nodes)) {
        const nodeDef = catalog.components[node.type]
        expect(nodeDef.propsSchema.safeParse(node.props).success).toBe(true)
      }
    }
  })
})

describe('validateDocumentContent', () => {
  it('accepts a new empty document', () => {
    const result = validateDocumentContent(createEmptyDocumentContent())
    expect(result.ok).toBe(true)
  })

  it('rejects broken envelopes', () => {
    expect(validateDocumentContent(null)).toEqual({
      ok: false,
      error: 'O conteúdo do documento é inválido',
    })
    const empty = createEmptyDocumentContent()
    const wrongCatalog = validateDocumentContent({ ...empty, catalog: 'site' })
    expect(wrongCatalog.ok).toBe(false)
    const wrongVersion = validateDocumentContent({ ...empty, version: 99 })
    expect(wrongVersion.ok).toBe(false)
    const wrongRoot = validateDocumentContent({ ...empty, rootId: 'nope' })
    expect(wrongRoot.ok).toBe(false)
  })

  it('rejects unknown types, bad props and misplaced nodes', () => {
    const unknown = createEmptyDocumentContent()
    unknown.nodes['section-1'].children = ['x']
    unknown.nodes.x = { id: 'x', type: 'signature', props: {} }
    const result = validateDocumentContent(unknown)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('signature')

    const badProps = createEmptyDocumentContent()
    badProps.nodes['section-1'].children = ['h']
    badProps.nodes.h = { id: 'h', type: 'heading', props: { text: 42 } }
    expect(validateDocumentContent(badProps).ok).toBe(false)

    const misplaced = createEmptyDocumentContent()
    misplaced.nodes['section-1'].children = ['c']
    misplaced.nodes.c = { id: 'c', type: 'column', props: {}, children: [] }
    expect(validateDocumentContent(misplaced).ok).toBe(false)
  })

  it('allows a single accept block', () => {
    const doc = createEmptyDocumentContent()
    doc.nodes['section-1'].children = ['a1', 'a2']
    doc.nodes.a1 = { id: 'a1', type: 'accept', props: {} }
    doc.nodes.a2 = { id: 'a2', type: 'accept', props: {} }
    const result = validateDocumentContent(doc)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('accept')
  })
})

describe('outlineToDocument', () => {
  it('converts every block type into a valid document', () => {
    const { content, theme } = outlineToDocument(FULL_OUTLINE)
    const result = validateDocumentContent(content)
    expect(result.ok ? true : result.error).toBe(true)
    expect(theme).toEqual({
      colors: { primary: '#0f766e' },
      fonts: { heading: 'serif', body: 'serif' },
      logoUrl: 'https://cdn.example.com/logo.png',
    })
  })

  it('keeps section names, variants and page breaks', () => {
    const { content } = outlineToDocument(FULL_OUTLINE)
    const sections = documentSections(content)
    expect(sections.map((section) => section.name)).toEqual([
      'Capa',
      'Conteúdo',
      'Dados',
    ])
    const [cover, middle] = sections.map((s) => content.nodes[s.id])
    expect(cover.props.variant).toBe('cover')
    expect(middle.props.variant).toBe('highlight')
    expect(middle.props.pageBreakBefore).toBe(true)
  })

  it('opens covers with the logo and a level-1 title', () => {
    const { content } = outlineToDocument(FULL_OUTLINE)
    const cover = content.nodes[documentSections(content)[0].id]
    const [logo, title] = (cover.children ?? []).map((id) => content.nodes[id])
    expect(logo.type).toBe('image')
    expect(logo.props.src).toBe('https://cdn.example.com/logo.png')
    expect(title.props.level).toBe('1')
  })

  it('keeps only the first accept block', () => {
    const { content } = outlineToDocument(FULL_OUTLINE)
    const accepts = nodesOfType(content, 'accept')
    expect(accepts).toHaveLength(1)
    expect(accepts[0].props.title).toBe('Aceite da proposta')
  })

  it('groups consecutive fields in a card with short fields paired', () => {
    const { content } = outlineToDocument(FULL_OUTLINE)
    const card = nodesOfType(content, 'container')[0]
    expect(card.props.style).toBe('card')
    const children = (card.children ?? []).map((id) => content.nodes[id])
    expect(children.map((child) => child.type)).toEqual([
      'columns',
      'field-textarea',
      'field-email',
      'field-select',
    ])
    const labels = documentFields(content).map((field) => field.label)
    expect(labels).toEqual(['Nome', 'CPF', 'Obs.', 'E-mail', 'Porte'])
  })

  it('converts pricing items and totals', () => {
    const { content } = outlineToDocument(FULL_OUTLINE)
    expect(documentPricingTotals(content)).toEqual({
      once: 200,
      monthly: 50,
      yearly: 0,
      total: 250,
    })
  })

  it('is deterministic', () => {
    const first = outlineToDocument(FULL_OUTLINE)
    const second = outlineToDocument(FULL_OUTLINE)
    expect(first).toEqual(second)
  })

  it('returns an empty theme when the outline has none', () => {
    const { theme } = outlineToDocument({
      title: 'Simples',
      kind: 'OTHER',
      sections: [{ name: 'Única', blocks: [] }],
    })
    expect(theme).toEqual({})
  })
})

describe('starters', () => {
  it('ships at least eight starters with unique ids', () => {
    expect(DOCUMENT_STARTERS.length).toBeGreaterThanOrEqual(8)
    const ids = DOCUMENT_STARTERS.map((starter) => starter.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const { id } of DOCUMENT_STARTERS) {
    it(`starter ${id} is a valid outline and document`, () => {
      const outline = getDocumentStarterOutline(id)
      expect(DocumentOutlineSchema.safeParse(outline).success).toBe(true)
      const starter = getDocumentStarter(id)
      expect(starter?.meta.id).toBe(id)
      const result = validateDocumentContent(starter?.content)
      expect(result.ok ? true : result.error).toBe(true)
      const content = starter?.content as CanvasDocument
      const count = documentSections(content).length
      expect(count).toBe(outline?.sections.length)
    })
  }

  it('returns null for unknown starters', () => {
    expect(getDocumentStarter('nope')).toBeNull()
    expect(getDocumentStarterOutline('nope')).toBeNull()
  })
})

describe('section presets', () => {
  it('builds valid section fragments', () => {
    const catalog = createDocumentCatalog()
    expect(DOCUMENT_SECTION_PRESETS.length).toBeGreaterThan(4)
    for (const preset of DOCUMENT_SECTION_PRESETS) {
      const fragment = preset.fragment()
      expect(fragment.nodes[fragment.rootId].type).toBe('section')
      expect(fragment.nodes.root).toBeUndefined()
      for (const node of Object.values(fragment.nodes)) {
        const definition = catalog.components[node.type]
        expect(definition.propsSchema.safeParse(node.props).success).toBe(true)
      }
    }
  })
})

describe('helpers', () => {
  it('computes column templates', () => {
    expect(columnsTemplate('1-2', 2)).toBe('minmax(0,1fr) minmax(0,2fr)')
    const equal = 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)'
    expect(columnsTemplate('1-2', 3)).toBe(equal)
    expect(columnsTemplate(undefined, 0)).toBe('minmax(0,1fr)')
  })

  it('recognizes hosted and file videos', () => {
    const youtube = videoSource('https://youtu.be/aqz-KE-bpKQ')
    expect(youtube.kind).toBe('embed')
    expect(youtube.thumbnail).toContain('aqz-KE-bpKQ')
    expect(videoSource('https://vimeo.com/123456789').kind).toBe('embed')
    expect(videoSource('https://cdn.x.dev/a.mp4').kind).toBe('file')
    expect(videoSource('javascript:alert(1)').kind).toBe('none')
    expect(videoSource('').kind).toBe('none')
  })
})

describe('describeDocumentError', () => {
  it('explains every engine error in pt-BR', () => {
    const cases = [
      describeDocumentError({ code: 'UNKNOWN_TYPE', type: 'x' }),
      describeDocumentError({ code: 'INVALID_PROPS', id: 'n', issues: ['a'] }),
      describeDocumentError({
        code: 'NOT_ACCEPTED',
        parentType: 'columns',
        childType: 'text',
      }),
      describeDocumentError({ code: 'MAX_CHILDREN', parentType: 'p', max: 4 }),
      describeDocumentError({ code: 'MIN_CHILDREN', parentType: 'p', min: 1 }),
      describeDocumentError({ code: 'UNIQUE', type: 'accept' }),
      describeDocumentError({ code: 'NODE_NOT_FOUND', id: 'n' }),
      describeDocumentError({ code: 'CYCLE', id: 'n' }),
      describeDocumentError({ code: 'INVALID_DOCUMENT', reason: 'r' }),
      describeDocumentError({ code: 'LOCKED', id: 'n' }),
    ]
    expect(cases).toEqual([
      'elemento desconhecido (x)',
      'propriedades inválidas em n: a',
      'text não pode ficar dentro de columns',
      'p aceita no máximo 4 itens',
      'p precisa de pelo menos 1 item',
      'só pode haver um elemento accept',
      'elemento n não encontrado',
      'o elemento n aparece duas vezes',
      'r',
      'LOCKED',
    ])
  })
})
