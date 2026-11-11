import { createContext, createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import {
  buildDocumentCatalog,
  DOC_END_ATTR,
  DOC_SECTION_ATTR,
  DOC_TRACK_ATTR,
  type DocumentRenderContext,
  DocumentView,
  documentCss,
  documentVariablesUsed,
  formatFieldValue,
  getDocumentStarter,
  renderDocumentHtml,
} from '@/src/lib/canvas-document'
import {
  fieldValueError,
  pricingRows,
  pricingSums,
} from '@/src/lib/canvas-document/components/views'
import {
  formatBRL,
  formatDocumentDate,
  isValidCnpj,
  isValidCpf,
  isValidEmail,
  maskCnpj,
  maskCpf,
  maskPhone,
  remainingTime,
} from '@/src/lib/canvas-document/format'
import { renderToHtml, styleToCss } from '@/src/lib/canvas-document/html'
import {
  defaultDocumentTheme,
  documentColorTokens,
  documentFontIdFor,
  documentPageBox,
  documentThemeSchema,
  documentViewportWidths,
  mixHex,
  parseDocumentTheme,
} from '@/src/lib/canvas-document/theme'
import { DocumentTree } from '@/src/lib/canvas-document/tree'
import {
  documentVariableSamples,
  splitVariables,
  substituteVariables,
} from '@/src/lib/canvas-document/variables'
import {
  appendToHtml,
  appendToText,
} from '@/src/lib/canvas-document/variables-tab'
import { DEFAULT_DOCUMENT_SETTINGS } from '@/src/schemas/document.schema'

const plain = (value: string) => value.replace(/\s/g, ' ')

function doc(sections: Array<[string, CanvasNode[]]>): CanvasDocument {
  const nodes: Record<string, CanvasNode> = {}
  const sectionIds: string[] = []
  sections.forEach(([name, children], index) => {
    const id = `s${index + 1}`
    sectionIds.push(id)
    nodes[id] = {
      id,
      type: 'section',
      props: {},
      children: children.map((child) => child.id),
      meta: { name },
    }
    for (const child of children) nodes[child.id] = child
  })
  nodes.root = {
    id: 'root',
    type: 'document',
    props: {},
    children: sectionIds,
  }
  return { catalog: 'document', version: 1, rootId: 'root', nodes }
}

const node = (
  id: string,
  type: string,
  props: Record<string, unknown>,
): CanvasNode => ({ id, type, props })

function context(
  overrides: Partial<DocumentRenderContext> = {},
): DocumentRenderContext {
  return {
    mode: 'print',
    settings: DEFAULT_DOCUMENT_SETTINGS,
    variables: { 'contato.nome': 'Ana' },
    ...overrides,
  }
}

const SAMPLE = doc([
  [
    'Abertura',
    [
      node('h', 'heading', { text: 'Olá, {{contato.nome}}', level: '1' }),
      node('t', 'text', {
        html: '<p>Veja <a href="https://example.com">o site</a> {{empresa.nome}}</p>',
      }),
    ],
  ],
  [
    'Preços',
    [
      node('pb', 'page-break', {}),
      node('p', 'pricing-table', {
        title: 'Investimento',
        items: [
          { id: 'a', name: 'Serviço', unitPrice: 1000, quantity: 1 },
          {
            id: 'b',
            name: 'Extra',
            unitPrice: 500,
            quantity: 1,
            optional: true,
          },
        ],
      }),
      node('f', 'field-cpf', { label: 'CPF' }),
      node('acc', 'accept', {}),
      node('pay', 'payment', {}),
      node('v', 'video', { url: 'https://youtu.be/aqz-KE-bpKQ' }),
      node('att', 'attachments', {
        files: [{ name: 'Anexo.pdf', url: 'https://x.dev/a.pdf' }],
      }),
    ],
  ],
])

describe('renderDocumentHtml', () => {
  const html = renderDocumentHtml({
    content: SAMPLE,
    theme: { colors: { primary: '#112233' } },
    context: context(),
    title: 'Proposta <Ana>',
  })

  it('is a standalone document without scripts', () => {
    expect(html.startsWith('<!doctype html><html lang="pt-BR">')).toBe(true)
    expect(html).toContain('<title>Proposta &lt;Ana&gt;</title>')
    expect(html).not.toContain('<script')
    expect(html).toContain('fonts.googleapis.com')
    expect(html).toContain('--canvas-primary:#112233')
  })

  it('sizes the page and breaks pages', () => {
    expect(html).toContain('@page{size:210mm 297mm;margin:18mm}')
    expect(html).toContain('class="d-pagebreak"')
    expect(html).toContain('d-mode-print')
  })

  it('puts the tracker contract in the DOM', () => {
    expect(html).toContain(`${DOC_SECTION_ATTR}="s1"`)
    expect(html).toContain('data-doc-section-name="Abertura"')
    expect(html.split(`${DOC_END_ATTR}=""`).length).toBe(2)
    expect(html).toContain(`<a ${DOC_TRACK_ATTR}="link" href=`)
    expect(html).toContain(`${DOC_TRACK_ATTR}="video"`)
    expect(html).toContain(`${DOC_TRACK_ATTR}="attachment"`)
  })

  it('resolves merge tags and leaves missing ones empty', () => {
    expect(html).toContain('Olá, Ana')
    expect(html).not.toContain('{{')
  })

  it('prints functional elements statically', () => {
    expect(plain(html)).toContain('R$ 1.000,00')
    expect(html).not.toContain('<input')
    expect(html).toContain('Assistir ao vídeo')
    expect(html).not.toContain('Pagar com Pix')
  })

  it('shows the answers and the accept when given', () => {
    const accepted = renderDocumentHtml({
      content: SAMPLE,
      theme: {},
      context: context({
        fieldValues: { f: '52998224725' },
        selection: { b: { selected: true, quantity: 1 } },
        acceptedByName: 'Ana Souza',
        acceptedAt: '2026-11-11T15:00:00.000Z',
        paymentEnabled: true,
      }),
      title: 'Aceito',
    })
    expect(accepted).toContain('529.982.247-25')
    expect(plain(accepted)).toContain('R$ 1.500,00')
    expect(accepted).toContain('Aceito por Ana Souza em 11/11/2026')
    expect(accepted).toContain('Pagar com Pix')
  })

  it('prints a first cover edge to edge', () => {
    const cover = doc([['Capa', [node('h', 'heading', { text: 'Capa' })]]])
    cover.nodes.s1.props = { variant: 'cover' }
    const out = renderDocumentHtml({
      content: cover,
      theme: {},
      context: context({
        settings: {
          ...DEFAULT_DOCUMENT_SETTINGS,
          pageSize: 'LETTER',
          orientation: 'landscape',
        },
      }),
      title: '',
    })
    expect(out).toContain('@page :first{margin:0}')
    expect(out).toContain('size:279.4mm 215.9mm')
    expect(out).toContain('<title>Documento</title>')
  })

  it('renders every starter', () => {
    const starter = getDocumentStarter('proposta-comercial')
    const out = renderDocumentHtml({
      content: starter?.content as CanvasDocument,
      theme: starter?.theme ?? {},
      context: context(),
      title: 'Proposta',
    })
    expect(out).toContain('d-section--cover')
    expect(out).toContain('d-toc')
  })
})

describe('editor and public renders', () => {
  it('shows merge-tag samples highlighted in the editor', () => {
    const catalog = buildDocumentCatalog({ mode: 'editor' }, () => SAMPLE)
    const tree = createElement(DocumentTree, { doc: SAMPLE, catalog })
    const out = renderToHtml(tree)
    expect(out).toContain('class="d-var" title="{{contato.nome}}"')
    expect(out).toContain('Maria Souza')
    expect(out).toContain('Quebra de página')
    expect(out).not.toContain(DOC_SECTION_ATTR)
    expect(out).toContain('Aparece no link quando o Pix estiver ativo')
    expect(out).toContain('<style data-document-css="">')
    expect(out).toContain('--canvas-primary:#2453d6')
  })

  it('styles the editor canvas with the theme from the context', () => {
    const theme = { colors: { primary: '#0f766e' } }
    const catalog = buildDocumentCatalog({ mode: 'editor', theme })
    const out = renderToHtml(
      catalog.renderDocument({ children: null, rootProps: {}, editing: true }),
    )
    expect(out).toContain('--canvas-primary:#0f766e')
    const print = buildDocumentCatalog({ mode: 'print' })
    const printOut = renderToHtml(
      print.renderDocument({ children: null, rootProps: {}, editing: false }),
    )
    expect(printOut).toBe('<div class="d-root d-mode-print d-layout-web"></div>')
  })

  it('renders live elements on the public link', () => {
    const out = renderToStaticMarkup(
      createElement(DocumentView, {
        content: SAMPLE,
        theme: {},
        context: context({ mode: 'public' }),
      }),
    )
    expect(out).toContain('<style data-document-css=""')
    expect(out).toContain('d-mode-public')
    expect(out).toContain('id="d-field-f"')
    expect(out).toContain('Pré-visualização')
    expect(out).toContain(`${DOC_TRACK_ATTR}="video"`)
    expect(out).not.toContain('d-float-toc')
  })

  it('adds the floating table of contents when the settings ask', () => {
    const settings = { ...DEFAULT_DOCUMENT_SETTINGS, showToc: true }
    const out = renderToStaticMarkup(
      createElement(DocumentView, {
        content: SAMPLE,
        theme: {},
        context: context({ mode: 'public', settings }),
      }),
    )
    expect(out).toContain('aria-label="Sumário do documento"')
    expect(out).toContain('href="#d-sec-s2"')
  })
})

describe('document theme', () => {
  it('ships a valid default theme', () => {
    const parsed = documentThemeSchema.safeParse(defaultDocumentTheme())
    expect(parsed.success).toBe(true)
    expect(parseDocumentTheme(null)).toEqual(defaultDocumentTheme())
  })

  it('derives secondary and highlight from the primary color', () => {
    const theme = parseDocumentTheme({ colors: { primary: '#ABC' } })
    expect(theme.colors.primary).toBe('#aabbcc')
    expect(theme.colors.highlight).toBe(mixHex('#aabbcc', '#ffffff', 0.93))
    expect(theme.colors.secondary).toBe(mixHex('#aabbcc', '#000000', 0.55))
  })

  it('corrects invalid values', () => {
    const theme = parseDocumentTheme({
      colors: { text: 'red', highlight: '#000000' },
      fonts: { heading: 'comic', body: 'serif' },
      baseSize: 99,
      radius: 4,
      logoUrl: '  https://x.dev/logo.png ',
    })
    expect(theme.colors.text).toBe(defaultDocumentTheme().colors.text)
    expect(theme.colors.highlight).toBe('#000000')
    expect(theme.fonts).toEqual({ heading: 'geist', body: 'serif' })
    expect(theme.baseSize).toBe(16)
    expect(theme.radius).toBe(4)
    expect(theme.logoUrl).toBe('https://x.dev/logo.png')
  })

  it('maps free-form font names', () => {
    expect(documentFontIdFor(undefined)).toBe('geist')
    expect(documentFontIdFor('Serifada')).toBe('serif')
    expect(documentFontIdFor('Fira Code')).toBe('mono')
    expect(documentFontIdFor('Roboto Slab')).toBe('slab')
    expect(documentFontIdFor('Merriweather')).toBe('serif')
    expect(documentFontIdFor('Noto Sans Serif')).toBe('humanist')
    expect(documentFontIdFor('Arial')).toBe('system')
    expect(documentFontIdFor('Inter')).toBe('geist')
  })

  it('exposes tokens, page boxes and viewport widths', () => {
    const tokens = documentColorTokens(defaultDocumentTheme())
    const primary = tokens.find((token) => token.id === 'primary')
    expect(primary?.label).toBe('Principal')
    const box = documentPageBox({ pageSize: 'A4', orientation: 'portrait' })
    expect(box).toEqual({ width: 210, height: 297 })
    const paged = documentViewportWidths({
      layout: 'paged',
      pageSize: 'A4',
      orientation: 'portrait',
    })
    expect(paged).toEqual({ base: 890, mobile: 390 })
    const web = documentViewportWidths(DEFAULT_DOCUMENT_SETTINGS)
    expect(web).toEqual({ base: 1024, mobile: 390 })
  })

  it('adds the paged sheet only outside print', () => {
    const settings = { ...DEFAULT_DOCUMENT_SETTINGS, layout: 'paged' as const }
    const theme = defaultDocumentTheme()
    const editor = documentCss(theme, { mode: 'editor', settings })
    expect(editor).toContain('.d-layout-paged .d-doc{width:210mm')
    expect(editor).toContain('Arraste elementos para esta seção')
    const print = documentCss(theme, { mode: 'print', settings })
    expect(print).not.toContain('.d-layout-paged .d-doc{width')
    expect(print).not.toContain('@page :first')
  })
})

describe('merge tags', () => {
  it('substitutes known tags and keeps unknown ones', () => {
    const values = { 'contato.nome': 'Ana' }
    expect(substituteVariables('Oi {{ contato.nome }}', values)).toBe('Oi Ana')
    expect(substituteVariables('{{empresa.nome}}!', values)).toBe('!')
    const unknown = substituteVariables('{{outra.coisa}}', values)
    expect(unknown).toBe('{{outra.coisa}}')
    expect(substituteVariables('sem tags', values)).toBe('sem tags')
    const shout = (value: string) => value.toUpperCase()
    const upper = substituteVariables('{{contato.nome}}', values, shout)
    expect(upper).toBe('ANA')
  })

  it('splits texts into runs and tags', () => {
    expect(splitVariables('a {{contato.nome}} {{x.y}} b')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'variable', key: 'contato.nome', tag: '{{contato.nome}}' },
      { kind: 'text', text: ' {{x.y}} b' },
    ])
  })

  it('lists the tags a document uses', () => {
    expect(documentVariablesUsed(SAMPLE)).toEqual([
      'contato.nome',
      'empresa.nome',
    ])
    expect(documentVariableSamples()['data.hoje']).toBe('11/11/2026')
  })

  it('appends tags to texts', () => {
    expect(appendToHtml('<p>Oi</p>', '{{a.b}}')).toBe('<p>Oi {{a.b}}</p>')
    expect(appendToHtml('', '{{a.b}}')).toBe('<p>{{a.b}}</p>')
    expect(appendToHtml('Oi', '{{a.b}}')).toBe('Oi {{a.b}}')
    expect(appendToText('Oi ', '{{a.b}}')).toBe('Oi {{a.b}}')
    expect(appendToText('', '{{a.b}}')).toBe('{{a.b}}')
  })
})

describe('formatting', () => {
  it('formats money and dates', () => {
    expect(plain(formatBRL(1234.5))).toBe('R$ 1.234,50')
    expect(plain(formatBRL(Number.NaN))).toBe('R$ 0,00')
    const iso = '2026-11-11T02:30:00.000Z'
    expect(formatDocumentDate(iso)).toBe('10/11/2026')
    expect(formatDocumentDate(iso, { timeZone: 'UTC' })).toBe('11/11/2026')
    const fallback = formatDocumentDate(iso, { timeZone: 'Nope/Zone' })
    expect(fallback).toBe('10/11/2026')
    expect(formatDocumentDate('invalid')).toBe('')
    expect(formatDocumentDate(null)).toBe('')
  })

  it('describes the time left', () => {
    const now = new Date('2026-11-11T00:00:00Z')
    const at = (ms: number) => new Date(now.getTime() + ms)
    expect(remainingTime(at(-1), now)).toBeNull()
    const twoDays = remainingTime(at(86_400_000 * 2 + 3_600_000), now)
    expect(twoDays).toBe('2 dias e 1 hora')
    expect(remainingTime(at(86_400_000), now)).toBe('1 dia')
    const twoHours = remainingTime(at(7_200_000 + 60_000), now)
    expect(twoHours).toBe('2 horas e 1 minuto')
    expect(remainingTime(at(3_600_000), now)).toBe('1 hora')
    expect(remainingTime(at(30_000), now)).toBe('1 minuto')
  })

  it('masks and validates Brazilian fields', () => {
    expect(maskCpf('5299822472599')).toBe('529.982.247-25')
    expect(maskCpf('5299')).toBe('529.9')
    expect(maskCpf('529982')).toBe('529.982')
    expect(maskCpf('5299822')).toBe('529.982.2')
    expect(maskCnpj('11222333000181')).toBe('11.222.333/0001-81')
    expect(maskCnpj('112')).toBe('11.2')
    expect(maskCnpj('112223')).toBe('11.222.3')
    expect(maskCnpj('112223330')).toBe('11.222.333/0')
    expect(maskPhone('11988887777')).toBe('(11) 98888-7777')
    expect(maskPhone('1133334444')).toBe('(11) 3333-4444')
    expect(maskPhone('1')).toBe('(1')
    expect(maskPhone('113')).toBe('(11) 3')
    expect(maskPhone('')).toBe('')
    expect(isValidCpf('529.982.247-25')).toBe(true)
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
    expect(isValidEmail('ana@empresa.com.br')).toBe(true)
    expect(isValidEmail('ana@empresa')).toBe(false)
  })

  it('validates and formats field answers', () => {
    expect(fieldValueError('field-cpf', '111.111.111-11')).toBe('CPF inválido.')
    const cnpj = fieldValueError('field-cnpj', '11.111.111/1111-11')
    expect(cnpj).toBe('CNPJ inválido.')
    expect(fieldValueError('field-email', 'x@')).toBe('E-mail inválido.')
    expect(fieldValueError('field-phone', '1199')).toBe('Telefone incompleto.')
    expect(fieldValueError('field-cpf', '')).toBeNull()
    expect(fieldValueError('field-text', 'qualquer')).toBeNull()
    expect(formatFieldValue('field-date', '2026-11-30')).toBe('30/11/2026')
    expect(formatFieldValue('field-checkbox', true)).toBe('Sim')
    expect(formatFieldValue('field-select', ['A', 'B'])).toBe('A, B')
    expect(formatFieldValue('field-number', 1500)).toBe('1.500')
    const masked = formatFieldValue('field-cnpj', '11222333000181')
    expect(masked).toBe('11.222.333/0001-81')
    expect(formatFieldValue('field-text', null)).toBe('')
  })

  it('computes pricing rows with the selection', () => {
    const items = [
      {
        id: 'a',
        name: 'A',
        unitPrice: 10,
        quantity: 2,
        quantityEditable: true,
      },
      {
        id: 'b',
        name: 'B',
        unitPrice: 5,
        quantity: 1,
        optional: true,
        recurrence: 'monthly' as const,
      },
    ]
    const rows = pricingRows(items, {
      a: { selected: true, quantity: 3 },
      b: { selected: true, quantity: 1 },
    })
    expect(rows.map((row) => row.total)).toEqual([30, 5])
    expect(pricingSums(rows)).toEqual({
      once: 30,
      monthly: 5,
      yearly: 0,
      total: 35,
    })
    expect(pricingRows(items)[1].selected).toBe(false)
  })
})

describe('renderToHtml', () => {
  it('writes attributes, styles and children like React', () => {
    const out = renderToHtml(
      createElement(
        'div',
        {
          className: 'a',
          style: {
            marginTop: 4,
            lineHeight: 1.5,
            '--x': 'y',
            color: undefined,
          } as never,
          hidden: true,
          'data-empty': '',
          onClick: () => {},
        },
        createElement('img', { src: '/a.png', alt: 'a "b"' }),
        'x < y',
        createElement('span', {
          dangerouslySetInnerHTML: { __html: '<b>raw</b>' },
        }),
        createElement('svg', { strokeWidth: 2, viewBox: '0 0 24 24' }),
        null,
        false,
        3,
      ),
    )
    const expected =
      '<div class="a" style="margin-top:4px;line-height:1.5;--x:y" hidden data-empty=""><img src="/a.png" alt="a &quot;b&quot;">x &lt; y<span><b>raw</b></span><svg stroke-width="2" viewBox="0 0 24 24"></svg>3</div>'
    expect(out).toBe(expected)
  })

  it('renders function components and keeps style text raw', () => {
    const Greeting = ({ name }: { name: string }) =>
      createElement('p', null, `Oi ${name}`)
    const out = renderToHtml([
      createElement(Greeting, { name: 'Ana', key: 'g' }),
      createElement('style', { key: 's' }, 'a>b{color:red}'),
    ])
    expect(out).toBe('<p>Oi Ana</p><style>a>b{color:red}</style>')
    const css = styleToCss({ opacity: 0, padding: 0, width: 10 })
    expect(css).toBe('opacity:0;padding:0;width:10px')
  })
})

describe('renderToHtml edge cases', () => {
  it('renders fragments and context providers through', () => {
    const Context = createContext('a')
    const tree = createElement(
      Context.Provider,
      { value: 'b' },
      createElement(Fragment, null, createElement('br'), 'ok'),
    )
    expect(renderToHtml(tree)).toBe('<br>ok')
  })

  it('ignores functions, symbols and empty values', () => {
    const out = renderToHtml(
      createElement('input', {
        readOnly: true,
        disabled: false,
        value: undefined,
        'aria-hidden': 'true',
      }),
    )
    expect(out).toBe('<input readonly aria-hidden="true">')
  })
})
