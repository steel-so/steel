import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  emailDocument,
  renderEditing,
} from '@/src/__tests__/helpers/email-canvas'
import { EMAIL_BLOCK_TYPES, emailCatalog } from '@/src/lib/canvas-email/catalog'
import { columnWidths } from '@/src/lib/canvas-email/components/layout'
import { npsHref } from '@/src/lib/canvas-email/components/relationship'
import { resolveProduct } from '@/src/lib/canvas-email/components/sales'
import {
  collectMobileCss,
  mobileClass,
  mobileRules,
  nodeClass,
  typographyCss,
} from '@/src/lib/canvas-email/mobile'
import { emailHref, softColor } from '@/src/lib/canvas-email/primitives'
import {
  applyOutlookMarkers,
  orderedChildren,
  renderEmailDocument,
} from '@/src/lib/canvas-email/render'
import { DEFAULT_EMAIL_BRAND } from '@/src/lib/canvas-email/theme'
import { personalizeEmail } from '@/src/lib/crm-email-builder/render'
import { contactToVariables } from '@/src/lib/crm-email-builder/variables'

const brand = {
  ...DEFAULT_EMAIL_BRAND,
  companyName: 'Acme',
  primaryColor: '#112233',
  address: 'Rua A, 1 — São Paulo',
  website: 'https://acme.example/',
  logoUrl: 'https://cdn.acme.example/logo.png',
}

const render = (
  doc: Parameters<typeof renderEmailDocument>[0],
  subject = 'Oi',
) => renderEmailDocument(doc, { brand, subject })

/** Everything the editor adds and the output must never carry. */
const EDITOR_MARKUP = [
  'data-canvas-id',
  'data-section-id',
  'data-ec-mso',
  'contenteditable',
  'Arraste blocos',
  'Escolha uma imagem',
  'Escreva o seu texto',
  'Texto do botão',
  'Escolha um produto',
  'Cole o seu HTML',
  'Preencha a assinatura',
  'opacity:0.35',
  'ec-mso-font',
]

describe('renderEmailDocument()', () => {
  it('never contains editor markup, even with empty and hidden blocks', async () => {
    const doc = emailDocument(
      [
        [
          EMAIL_BLOCK_TYPES.map((type) => ({ type })),
          [
            { type: 'email.heading', props: { text: '' } },
            { type: 'email.text', props: { html: '' } },
            { type: 'email.button', props: { label: '' } },
            { type: 'email.image' },
            { type: 'email.video' },
            { type: 'email.product' },
            { type: 'email.html', props: { html: '' } },
            { type: 'email.quote', props: { text: '' } },
            { type: 'email.coupon', props: { code: '' } },
            {
              type: 'email.signature',
              props: { closing: '', name: '', role: '', contact: '' },
            },
          ],
        ],
        [[]],
      ],
      { root: { fontFamily: 'poppins' } },
    )
    const { html, text } = await render(doc)
    for (const marker of EDITOR_MARKUP) {
      expect(html, marker).not.toContain(marker)
    }
    expect(text).not.toContain('data-')
  })

  it('renders a real e-mail: html, preheader, title, footer with unsubscribe', async () => {
    const doc = emailDocument([[[{ type: 'email.text' }]]], {
      root: { preheader: 'Resumo do mês' },
      footer: { note: 'Nota do rodapé', address: '' },
    })
    const { html, text, subject } = await render(doc, 'Novidades')
    expect(subject).toBe('Novidades')
    expect(html).toMatch(/^<!DOCTYPE html/)
    expect(html).toContain('<html dir="ltr" lang="pt-BR">')
    expect(html).toContain('<title>Novidades</title>')
    expect(html).toContain('Resumo do mês')
    expect(html).toContain('href="{{unsubscribe_url}}"')
    expect(html).toContain('Rua A, 1 — São Paulo')
    expect(html).toContain('acme.example</a>')
    expect(html).toContain('Nota do rodapé')
    expect(text).toContain('Descadastrar')
  })

  it('keeps {{variables}} intact for per-recipient personalization', async () => {
    const doc = emailDocument([
      [
        [
          {
            type: 'email.heading',
            props: { text: 'Olá, {{primeiro_nome|cliente}}!' },
          },
          {
            type: 'email.text',
            props: { html: '<p>Na {{empresa}} você encontra tudo.</p>' },
          },
          {
            type: 'email.button',
            props: { link: { type: 'url', value: '{{campaign_link}}' } },
          },
        ],
      ],
    ])
    const rendered = await render(doc, 'Oi {{primeiro_nome}}')
    expect(rendered.html).toContain('Olá, {{primeiro_nome|cliente}}!')
    expect(rendered.html).toContain('{{empresa}}')
    expect(rendered.html).toContain('href="{{campaign_link}}"')
    const personal = personalizeEmail(
      rendered,
      contactToVariables(
        { email: 'm@x.com', name: 'Maria Silva', company: 'Acme' },
        { campaignLink: 'https://c.example/?utm=1' },
      ),
    )
    expect(personal.subject).toBe('Oi Maria')
    expect(personal.html).toContain('Olá, Maria!')
    expect(personal.html).toContain('Na Acme você')
    expect(personal.html).toContain('href="https://c.example/?utm=1"')
  })

  it('wraps the container in an Outlook ghost table and falls back fonts', async () => {
    const doc = emailDocument(undefined, {
      root: { fontFamily: 'montserrat', width: 640 },
    })
    const { html } = await render(doc)
    expect(html).toContain(
      '<!--[if mso]><table role="presentation" width="640" align="center"',
    )
    expect(html).toContain('<!--[if mso]></td></tr></table><![endif]-->')
    expect(html).toContain('font-family:Arial,Helvetica,sans-serif !important')
    expect(html).toContain('family=Montserrat')
    expect(html).toContain('max-width:640px')

    const safe = await render(emailDocument())
    expect(safe.html).not.toContain('fonts.googleapis.com')
    expect(safe.html).not.toContain('[if mso]><style>')
  })

  it('turns mobile overrides into media-query rules on node classes', async () => {
    const doc = emailDocument([
      [
        [
          {
            type: 'email.heading',
            id: 'h1',
            props: {
              align: { base: 'left', mobile: 'center' },
              typography: {
                base: { fontSize: 32 },
                mobile: { fontSize: 20, fontFamily: 'Inter</style>, x' },
              },
            },
          },
          {
            type: 'email.spacer',
            id: 'sp',
            props: { height: { base: 40, mobile: 12 } },
          },
          {
            type: 'email.text',
            id: 'tx',
            props: {
              visibility: { base: true, tablet: true, mobile: false },
            },
          },
          {
            type: 'email.text',
            id: 'mo',
            props: {
              visibility: { base: false, tablet: false, mobile: true },
            },
          },
          {
            type: 'email.text',
            id: 'gone',
            props: {
              html: '<p>NUNCA</p>',
              visibility: { base: false, tablet: false, mobile: false },
            },
          },
        ],
        [
          {
            type: 'email.image',
            props: { image: { src: 'https://x.example/a.png', alt: 'a' } },
          },
        ],
      ],
    ])
    const { html } = await render(doc)
    expect(html).toContain('@media only screen and (max-width:600px)')
    expect(html).toContain('.ec-h1{text-align:center !important}')
    expect(html).toContain(
      '.ec-h1-t{font-family:Interstyle, x !important;font-size:20px !important}',
    )
    expect(html).not.toContain('</style>, x')
    expect(html).toContain(
      '.ec-sp{height:12px !important;line-height:12px !important}',
    )
    expect(html).toContain('class="ec-h1-t"')
    expect(html).toContain('class="ec-hide-m"')
    expect(html).toContain('class="ec-show-m"')
    expect(html).toContain('mso-hide:all')
    expect(html).toContain('class="ec-stack"')
    expect(html).toContain('ec-img-full')
    expect(html).not.toContain('NUNCA')
    expect(html).toContain('width="50%"')
  })

  it('drops hidden nodes and always renders the footer last', async () => {
    const doc = emailDocument([
      [[{ type: 'email.text', props: { html: '<p>VISIVEL</p>' } }]],
      [[{ type: 'email.text', props: { html: '<p>OCULTO</p>' } }]],
    ])
    doc.nodes.s1.meta = { hidden: true }
    doc.nodes.root.children = ['footer', 's0', 's1']
    expect(orderedChildren(doc.nodes.root, doc)).toEqual(['s0', 's1', 'footer'])
    expect(orderedChildren(doc.nodes.s0, doc)).toEqual(['s0c0'])
    const { html } = await render(doc)
    expect(html).toContain('VISIVEL')
    expect(html).not.toContain('OCULTO')
    expect(html.indexOf('VISIVEL')).toBeLessThan(html.indexOf('Descadastrar'))
  })

  it('skips unknown node types and missing children', async () => {
    const doc = emailDocument()
    doc.nodes.s0c0.children = ['b0', 'missing']
    doc.nodes.weird = { id: 'weird', type: 'email.nope', props: {} }
    doc.nodes.s0c0.children.push('weird')
    const { html } = await render(doc)
    expect(html).toContain('Escreva aqui a sua mensagem')
  })

  it('renders section backgrounds, borders and column backgrounds', async () => {
    const color = await render(
      emailDocument([[[{ type: 'email.text' }]]], {
        section: {
          background: { kind: 'color', color: 'token:primary' },
          border: { width: 2, style: 'solid', color: '#ff0000' },
          radius: 8,
        },
        column: { backgroundColor: '#eeeeee', width: 40 },
      }),
    )
    expect(color.html).toContain('background-color:#112233')
    expect(color.html).toContain('border:2px solid #ff0000')
    expect(color.html).toContain('bgcolor="#eeeeee"')

    const gradient = await render(
      emailDocument(undefined, {
        section: {
          background: {
            kind: 'gradient',
            angle: 90,
            from: '#000000',
            to: '#ffffff',
          },
          border: { width: 0, style: 'solid', color: '#ff0000' },
        },
      }),
    )
    expect(gradient.html).toContain('linear-gradient(90deg, #000000, #ffffff)')
    expect(gradient.html).not.toContain('border:0px')

    const image = await render(
      emailDocument(undefined, {
        section: {
          background: {
            kind: 'image',
            url: 'https://x.example/bg (1).png',
            color: '#333333',
            position: 'center',
            size: 'cover',
            repeat: false,
          },
        },
      }),
    )
    expect(image.html).toContain('bg%20%281%29.png')
    expect(image.html).toContain('background-repeat:no-repeat')

    const noUrl = await render(
      emailDocument(undefined, {
        section: {
          background: {
            kind: 'image',
            url: '',
            position: 'top',
            size: 'contain',
            repeat: true,
          },
        },
      }),
    )
    expect(noUrl.html).toContain('background-repeat:repeat')
    expect(noUrl.html).not.toContain('url(')
  })

  it('renders every block with its content', async () => {
    const doc = emailDocument([
      [
        [
          {
            type: 'email.button',
            props: {
              label: 'Comprar',
              fullWidth: true,
              border: { width: 1, style: 'solid', color: '#000000' },
              link: { type: 'email', value: 'vendas@acme.example' },
            },
          },
          {
            type: 'email.image',
            props: {
              image: { src: 'https://x.example/i.png', alt: 'Foto' },
              link: { type: 'url', value: 'https://x.example' },
              width: 200,
              mobileFullWidth: false,
            },
          },
          {
            type: 'email.divider',
            props: { style: 'dashed', thickness: 2, width: 50 },
          },
          { type: 'email.list', props: { marker: 'bullet' } },
          {
            type: 'email.list',
            props: {
              marker: 'check',
              items: [{ title: '', text: 'Só texto' }],
            },
          },
          {
            type: 'email.list',
            props: { items: [{ title: 'Só título', text: '' }] },
          },
          {
            type: 'email.logo',
            props: { link: { type: 'url', value: 'https://acme.example' } },
          },
          {
            type: 'email.logo',
            props: { image: { src: 'https://x.example/own.png', alt: 'Own' } },
          },
          { type: 'email.social', props: { variant: 'solid' } },
          { type: 'email.social', props: { variant: 'text' } },
          { type: 'email.social' },
          { type: 'email.menu' },
          { type: 'email.menu', props: { separator: '' } },
          { type: 'email.signature' },
          {
            type: 'email.signature',
            props: {
              photo: { src: 'https://x.example/me.png', alt: '' },
              contact: '(11) 9999-0000',
              align: 'center',
            },
          },
        ],
        [
          {
            type: 'email.product',
            props: {
              name: 'Plano Pro',
              description: 'Tudo',
              price: 'R$ 10',
              oldPrice: 'R$ 20',
              image: { src: 'https://x.example/p.png', alt: '' },
            },
          },
          {
            type: 'email.product',
            props: {
              name: 'Vertical',
              layout: 'vertical',
              image: { src: 'https://x.example/v.png', alt: 'V' },
              border: { width: 1, style: 'dotted', color: '#cccccc' },
              link: { type: 'url', value: '' },
            },
          },
          {
            type: 'email.product',
            props: { name: 'Sem imagem', layout: 'vertical' },
          },
          {
            type: 'email.coupon',
            props: { backgroundColor: '#fafafa', expiry: '' },
          },
          { type: 'email.coupon', props: { label: '' } },
          { type: 'email.quote' },
          { type: 'email.quote', props: { author: '', role: '' } },
          { type: 'email.quote', props: { role: '' } },
          {
            type: 'email.nps',
            props: {
              link: { type: 'url', value: 'https://n.example/r?x=1#top' },
            },
          },
          {
            type: 'email.nps',
            props: { question: '', link: { type: 'url', value: '' } },
          },
          { type: 'email.event' },
          {
            type: 'email.event',
            props: {
              heading: '',
              time: '',
              buttonLabel: '',
              accentColor: 'token:x',
            },
          },
          {
            type: 'email.video',
            props: {
              thumbnail: { src: 'https://x.example/t.png', alt: '' },
              link: { type: 'url', value: 'https://video.example' },
            },
          },
          {
            type: 'email.video',
            props: {
              thumbnail: { src: 'https://x.example/t2.png', alt: 'T' },
              label: '',
              radius: 0,
            },
          },
          {
            type: 'email.html',
            props: {
              html: '<table><tr><td onclick="x()">Cód<script>alert(1)</script></td></tr></table>',
            },
          },
        ],
      ],
    ])
    const { html } = await render(doc)
    expect(html).toContain('href="mailto:vendas@acme.example"')
    expect(html).toContain('display:block')
    expect(html).toContain('width:200px')
    expect(html).toContain('border-top:2px dashed')
    expect(html).toContain('•')
    expect(html).toContain('✓')
    expect(html).toContain('https://cdn.acme.example/logo.png')
    expect(html).toContain('https://x.example/own.png')
    expect(html).toContain('Instagram')
    expect(html).toContain('LinkedIn')
    expect(html).toContain('Produtos')
    expect(html).toContain('https://x.example/me.png')
    expect(html).toContain('Plano Pro')
    expect(html).toContain('line-through')
    expect(html).toContain('border:1px dotted #cccccc')
    expect(html).toContain('BEMVINDO10')
    expect(html).toContain('href="https://n.example/r?x=1&amp;nota=7#top"')
    expect(html).toContain('Encontro de clientes')
    expect(html).toContain('▶ Assistir ao vídeo')
    expect(html).toContain('https://x.example/t2.png')
    expect(html).toContain('Cód')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('<script')
  })

  it('omits empty blocks from the output', async () => {
    const doc = emailDocument([
      [
        [
          { type: 'email.heading', props: { text: ' ' } },
          { type: 'email.text', props: { html: '' } },
          { type: 'email.button', props: { label: '' } },
          { type: 'email.image' },
          { type: 'email.video' },
          { type: 'email.product' },
          { type: 'email.quote', props: { text: '' } },
          { type: 'email.html', props: { html: '<script>x</script>' } },
        ],
      ],
    ])
    const { html } = await render(doc)
    expect(html).not.toContain('<h2')
    expect(html).not.toContain('<a href="{{campaign_link}}"')
  })

  it('fills product blocks from CRM data', async () => {
    const doc = emailDocument([
      [[{ type: 'email.product', props: { productId: 'p1', price: '' } }]],
    ])
    const { html } = await renderEmailDocument(doc, {
      brand,
      subject: 'x',
      products: {
        p1: { name: 'Do CRM', description: 'Descrição CRM', price: 'R$ 99,90' },
      },
    })
    expect(html).toContain('Do CRM')
    expect(html).toContain('Descrição CRM')
    expect(html).toContain('R$ 99,90')
  })
})

describe('render helpers', () => {
  it('resolves product data: block fields win over the CRM', () => {
    const base = {
      productId: 'p1',
      name: '',
      description: 'Minha descrição',
      price: '',
      oldPrice: ' R$ 5 ',
    } as Parameters<typeof resolveProduct>[0]
    expect(
      resolveProduct(base, {
        p1: { name: 'CRM', description: 'CRM d', price: 'R$ 1' },
      }),
    ).toEqual({
      name: 'CRM',
      description: 'Minha descrição',
      price: 'R$ 1',
      oldPrice: 'R$ 5',
    })
    expect(resolveProduct({ ...base, productId: null }, {}).name).toBe('')
    expect(resolveProduct({ ...base, productId: 'gone' }, {}).price).toBe('')
  })

  it('builds hrefs for every link type', () => {
    expect(emailHref(undefined)).toBeUndefined()
    expect(emailHref({ type: 'url', value: '  ' })).toBeUndefined()
    expect(emailHref({ type: 'url', value: 'https://a.b' })).toBe('https://a.b')
    expect(emailHref({ type: 'email', value: 'a@b.c' })).toBe('mailto:a@b.c')
    expect(emailHref({ type: 'email', value: 'mailto:a@b.c' })).toBe(
      'mailto:a@b.c',
    )
    expect(emailHref({ type: 'phone', value: '(11) 9999-0000' })).toBe(
      'tel:1199990000',
    )
    expect(emailHref({ type: 'phone', value: 'tel:+55' })).toBe('tel:+55')
  })

  it('appends the NPS score before the hash', () => {
    expect(npsHref(undefined, 3)).toBe('')
    expect(npsHref('https://a.b/r', 3)).toBe('https://a.b/r?nota=3')
    expect(npsHref('https://a.b/r?x=1#h', 0)).toBe('https://a.b/r?x=1&nota=0#h')
  })

  it('tints only #RRGGBB colors', () => {
    expect(softColor(undefined, 0.1)).toBeUndefined()
    expect(softColor('#000000', 0.5)).toBe('#808080')
    expect(softColor('#abc', 0.5)).toBe('#abc')
  })

  it('collects mobile rules only for real overrides', () => {
    const doc = emailDocument([[[{ type: 'email.text', id: 't' }]]])
    expect(mobileRules(doc.nodes.t)).toEqual([])
    expect(mobileClass(doc.nodes.t, 'cell')).toBeUndefined()
    expect(nodeClass('a.b#c', 'text')).toBe('ec-abc-t')
    expect(
      typographyCss({
        fontWeight: 700,
        lineHeight: 1.4,
        letterSpacing: 1,
        textTransform: 'uppercase',
        italic: false,
      }),
    ).toBe(
      'font-weight:700;line-height:1.4;letter-spacing:1px;text-transform:uppercase;font-style:normal',
    )
    expect(typographyCss({ italic: true })).toBe('font-style:italic')
    const empty = emailDocument([
      [
        [
          {
            type: 'email.text',
            id: 'e',
            props: { typography: { base: { fontSize: 12 }, mobile: {} } },
          },
        ],
      ],
    ])
    expect(mobileRules(empty.nodes.e)).toEqual([])
    empty.nodes.s0.meta = { hidden: true }
    expect(collectMobileCss(empty, 600)).not.toContain('.ec-e')
  })

  it('swaps only the Outlook markers', () => {
    expect(applyOutlookMarkers('<p>x</p>', 600)).toBe('<p>x</p>')
  })
})

/** Every `token:*` value in props replaced by an unknown token. */
function unknownTokens(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.startsWith('token:') ? 'token:unknown' : value
  }
  if (Array.isArray(value)) return value.map(unknownTokens)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, unknownTokens(v)]),
    )
  }
  return value
}

describe('fallbacks and edge cases', () => {
  it('falls back to the palette when a color token is unknown', async () => {
    const doc = emailDocument([[EMAIL_BLOCK_TYPES.map((type) => ({ type }))]], {
      root: { textColor: 'token:x', linkColor: 'token:x' },
      footer: { textColor: 'token:x', showDivider: false },
    })
    for (const node of Object.values(doc.nodes)) {
      node.props = unknownTokens(node.props) as typeof node.props
    }
    const { html } = await render(doc)
    expect(html).not.toContain('token:')
    expect(html).not.toContain('var(--')
    expect(html).toContain('#14171E')
    // Only the divider block: the footer line is off.
    expect(html.match(/<hr/g)).toHaveLength(1)
  })

  it('emits mobile padding rules and reads non-hex accents', async () => {
    const doc = emailDocument([
      [
        [
          {
            type: 'email.text',
            id: 'pd',
            props: {
              padding: {
                base: { top: 8, right: 0, bottom: 8, left: 0 },
                mobile: { top: 4, right: 4, bottom: 4, left: 4 },
              },
            },
          },
          { type: 'email.event', props: { accentColor: '#abc' } },
          {
            type: 'email.image',
            props: { image: { src: 'https://x/a.png', alt: 'a' }, radius: 0 },
          },
        ],
      ],
    ])
    const { html } = await render(doc)
    expect(html).toContain('.ec-pd{padding:4px 4px 4px 4px !important}')
    expect(html).toContain('color:#FFFFFF')
  })

  it('renders an image inside the editor and a column outside a section', () => {
    const doc = emailDocument([
      [
        [
          {
            type: 'email.image',
            props: { image: { src: 'https://x/a.png', alt: 'a' } },
          },
        ],
      ],
    ])
    expect(renderEditing(doc)).toContain('src="https://x/a.png"')
    // A column rendered without its section (no siblings) takes 100%.
    const column = emailCatalog.components['email.column'].render({
      node: doc.nodes.s0c0,
      breakpoint: 'base',
      editing: false,
    })
    expect(renderToStaticMarkup(column as ReactElement)).toContain(
      'width="100%"',
    )
  })

  it('splits widths equally when every width is zero', () => {
    expect(columnWidths([0, 0])).toEqual([50, 50])
  })
})
