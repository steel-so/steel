import { describe, expect, it } from 'vitest'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { SITE_KITS } from '@/src/lib/canvas-site/presets'
import { validateSiteDocument } from '@/src/lib/sites/document'
import {
  convertLandingPage,
  kitForTemplate,
  type LandingSource,
} from '@/src/lib/sites/landing-converter'

type Section = LandingSource['sections'][number]

const link = { label: 'Contato', href: '#contato' }

/** Every field filled. */
const FULL: Record<string, Record<string, unknown>> = {
  HEADER: {
    logoText: 'Clínica',
    navLinks: [link],
    ctaLabel: 'Agendar',
    ctaHref: '/agendar',
  },
  HERO: {
    eyebrow: 'Saúde',
    title: 'Cuidamos de você',
    subtitle: 'Desde 1990',
    ctaLabel: 'Agendar',
    ctaHref: '#agenda',
    imageUrl: '/media/hero.png',
    videoUrl: '/media/hero.mp4',
  },
  SERVICES: {
    title: 'Serviços',
    subtitle: 'O que fazemos',
    items: [
      {
        title: 'Consulta',
        description: 'Clínica geral',
        imageUrl: '/media/c.png',
      },
    ],
    videoUrl: '/media/s.mp4',
  },
  FACTS: { items: [{ value: '30+', label: 'anos' }] },
  ABOUT: {
    eyebrow: 'Sobre',
    title: 'Quem somos',
    description: 'História',
    imageUrl: '/media/a.png',
    imageUrls: ['/media/b.png'],
  },
  TESTIMONIAL: {
    quote: 'Ótimo',
    authorName: 'Ana',
    authorRole: 'Paciente',
    avatarUrl: '/media/ana.png',
  },
  FEATURES: {
    title: 'Diferenciais',
    subtitle: 'Por quê',
    items: [{ title: 'Rápido', description: 'Sem fila' }],
    ctaTitle: 'Venha',
    ctaDescription: 'Hoje',
    ctaLabel: 'Agendar',
    ctaHref: '/agendar',
  },
  WORKS: {
    title: 'Projetos',
    subtitle: 'Casos',
    items: [{ title: 'Reforma', category: 'Obra', imageUrl: '/media/w.png' }],
  },
  FOOTER: {
    logoText: 'Clínica',
    text: '© 2026',
    linkGroups: [
      { title: 'Links', links: [link] },
      { title: 'Vazio', links: [] },
    ],
    socialLinks: [{ platform: 'instagram', href: 'https://instagram.com/x' }],
    ctaTitle: 'Fale',
    ctaDescription: 'Conosco',
    ctaLabel: 'Contato',
    ctaHref: '#contato',
  },
  PRICING: {
    title: 'Preços',
    subtitle: 'Planos',
    plans: [
      {
        name: 'Básico',
        price: 'R$ 99',
        period: '/mês',
        features: ['Consulta'],
        ctaLabel: 'Assinar',
        ctaHref: '/assinar',
      },
      { name: 'Livre', price: 'Grátis', features: [] },
    ],
  },
  FAQ: {
    title: 'Dúvidas',
    subtitle: 'Perguntas',
    items: [{ question: 'Atende convênio?', answer: 'Sim' }],
  },
  STEPS: {
    eyebrow: 'Passos',
    title: 'Como funciona',
    subtitle: 'Simples',
    imageUrl: '/media/s.png',
    items: [{ title: 'Agende', description: 'Online' }],
  },
  NEWSLETTER: { title: 'Novidades', description: 'Assine', formId: 'form-1' },
  LOGOS: {
    title: 'Parceiros',
    logos: [{ name: 'Acme', imageUrl: '/media/acme.png' }, { name: 'Beta' }],
  },
  PRODUCTS: {
    title: 'Produtos',
    subtitle: 'Loja',
    items: [
      {
        title: 'Kit',
        price: 'R$ 50',
        originalPrice: 'R$ 70',
        imageUrl: '/media/k.png',
      },
      { title: 'Gel', price: 'R$ 10' },
    ],
  },
}

/** Only the required fields. */
const MINIMAL: Record<string, Record<string, unknown>> = {
  HEADER: { logoText: 'Clínica' },
  HERO: { title: 'Olá' },
  SERVICES: { title: 'Serviços', items: [{ title: 'Consulta' }] },
  FACTS: {},
  ABOUT: { title: 'Sobre' },
  TESTIMONIAL: { quote: 'Bom', authorName: 'Ana' },
  FEATURES: { title: 'Diferenciais' },
  WORKS: { title: 'Projetos', items: [{ title: 'Casa' }] },
  FOOTER: {},
  PRICING: { title: 'Preços' },
  FAQ: { title: 'Dúvidas' },
  STEPS: { title: 'Passos' },
  NEWSLETTER: { title: 'Novidades' },
  LOGOS: {},
  PRODUCTS: { title: 'Produtos' },
}

function sections(
  contents: Record<string, Record<string, unknown>>,
): Section[] {
  return Object.entries(contents).map(([type, content], order) => ({
    type: type as Section['type'],
    order,
    enabled: true,
    content: { type, ...content },
  }))
}

function types(doc: CanvasDocument | null): string[] {
  return Object.values(doc?.nodes ?? {}).map((node) => node.type)
}

function props(doc: CanvasDocument, type: string) {
  return Object.values(doc.nodes)
    .filter((node) => node.type === type)
    .map((node) => node.props)
}

describe('kitForTemplate', () => {
  it('maps templates to the closest kit', () => {
    expect(kitForTemplate('agency')).toBe('agency')
    expect(kitForTemplate('coworking')).toBe('b2b')
    expect(kitForTemplate('web-application')).toBe('saas')
  })

  it('styles bands with the kit preset and returns its theme', () => {
    const agency = convertLandingPage({
      title: 'x',
      templateKey: 'agency',
      sections: sections({ HERO: { title: 'A' } }),
    })
    const saas = convertLandingPage({
      title: 'x',
      templateKey: 'saas-subscription',
      sections: sections({ HERO: { title: 'A' } }),
    })
    expect(agency.theme).toEqual(SITE_KITS.agency.theme)
    expect(saas.theme).toEqual(SITE_KITS.saas.theme)
    const band = (doc: CanvasDocument) => props(doc, 'site.section')[0]
    expect(band(agency.page)).toMatchObject({ anchor: 'destaque' })
    expect(band(agency.page)).not.toEqual(band(saas.page))
  })
})

describe('convertLandingPage', () => {
  it.each([
    ['full', FULL],
    ['minimal', MINIMAL],
  ])(
    'converts every section type (%s) into catalog-valid documents',
    (_label, contents) => {
      const result = convertLandingPage({
        title: 'Clínica',
        templateKey: 'agency',
        sections: sections(contents),
      })
      expect(result.skipped).toBe(0)
      for (const doc of [result.page, result.header, result.footer]) {
        const checked = validateSiteDocument(doc)
        expect(checked.ok ? [] : checked.error).toEqual([])
      }
      const anchors = props(result.page, 'site.section').map((p) => p.anchor)
      expect(anchors).toContain('servicos')
      expect(anchors).not.toContain('cabecalho')
      expect(
        props(result.header as CanvasDocument, 'site.section')[0],
      ).toMatchObject({ anchor: 'cabecalho', tag: 'header' })
      expect(
        props(result.footer as CanvasDocument, 'site.section')[0],
      ).toMatchObject({ anchor: 'rodape', tag: 'footer' })
    },
  )

  it('carries content, media, forms and menus over', () => {
    const result = convertLandingPage({
      title: 'Clínica',
      templateKey: 'agency',
      sections: sections(FULL),
    })
    expect(types(result.page)).toEqual(
      expect.arrayContaining([
        'site.video',
        'site.image',
        'site.list',
        'site.form',
      ]),
    )
    expect(props(result.page, 'site.form')[0]).toMatchObject({
      formId: 'form-1',
    })
    expect(props(result.page, 'site.video')[0]).toMatchObject({
      url: '/media/hero.mp4',
      source: 'upload',
      poster: '/media/hero.png',
    })
    expect(props(result.page, 'site.heading')).toContainEqual(
      expect.objectContaining({ text: 'Cuidamos de você', level: 'h1' }),
    )
    expect(props(result.page, 'site.text')).toContainEqual(
      expect.objectContaining({
        html: '<p>R$ 50 (de R$ 70)</p>',
        preset: 'lead',
      }),
    )
    expect(props(result.page, 'site.section')).toContainEqual(
      expect.objectContaining({ anchor: 'depoimentos' }),
    )
    expect(result.header?.nodes.root.props).toMatchObject({ tag: 'div' })
    expect(result.footer?.nodes.root.props).toMatchObject({ tag: 'div' })
    expect(
      props(result.header as CanvasDocument, 'site.menu')[0],
    ).toMatchObject({
      source: 'custom',
      items: [{ label: 'Contato', link: { type: 'anchor', value: 'contato' } }],
    })
    expect(
      props(result.footer as CanvasDocument, 'site.social')[0],
    ).toMatchObject({
      items: [{ network: 'instagram', url: 'https://instagram.com/x' }],
    })
    expect(props(result.page, 'site.button')).toContainEqual(
      expect.objectContaining({
        label: 'Assinar',
        link: { type: 'url', value: '/assinar' },
      }),
    )
  })

  it('escapes copy, detects video hosts and drops unknown networks', () => {
    const result = convertLandingPage({
      title: 'x',
      templateKey: 'agency',
      sections: sections({
        HERO: {
          title: 'A',
          subtitle: '<script>',
          videoUrl: 'https://youtu.be/abc',
        },
        STEPS: { title: 'Passos', videoUrl: 'https://vimeo.com/1' },
        FOOTER: {
          socialLinks: [
            { platform: 'Twitter', href: 'https://x.com/a' },
            { platform: 'orkut', href: 'https://o.com' },
          ],
        },
      }),
    })
    expect(props(result.page, 'site.text')).toContainEqual(
      expect.objectContaining({ html: '<p>&lt;script&gt;</p>' }),
    )
    expect(props(result.page, 'site.video').map((p) => p.source)).toEqual([
      'youtube',
      'vimeo',
    ])
    expect(
      props(result.footer as CanvasDocument, 'site.social')[0].items,
    ).toEqual([{ network: 'x', url: 'https://x.com/a' }])
    const none = convertLandingPage({
      title: 'x',
      templateKey: 'agency',
      sections: sections({
        FOOTER: { socialLinks: [{ platform: 'orkut', href: 'https://o.com' }] },
      }),
    })
    expect(types(none.footer)).not.toContain('site.social')
  })

  it('keeps a second header inline and skips disabled or broken sections', () => {
    const result = convertLandingPage({
      title: 'Clínica',
      templateKey: 'b2b',
      sections: [
        {
          type: 'HEADER',
          order: 0,
          enabled: true,
          content: { type: 'HEADER', logoText: 'A' },
        },
        {
          type: 'HERO',
          order: 1,
          enabled: true,
          content: { type: 'HERO', title: 'Oi', ctaLabel: 'Ir' },
        },
        {
          type: 'HEADER',
          order: 2,
          enabled: true,
          content: { type: 'HEADER', logoText: 'B' },
        },
        {
          type: 'FOOTER',
          order: 3,
          enabled: false,
          content: { type: 'FOOTER' },
        },
        { type: 'FAQ', order: 4, enabled: true, content: { type: 'FAQ' } },
        {
          type: 'HERO',
          order: 5,
          enabled: true,
          content: { type: 'FAQ', title: 'x' },
        },
      ],
    })
    expect(result.skipped).toBe(2)
    expect(result.footer).toBeNull()
    expect(props(result.page, 'site.section').map((p) => p.anchor)).toEqual([
      'destaque',
      'cabecalho-2',
    ])
    expect(props(result.page, 'site.button')).toEqual([
      expect.objectContaining({
        label: 'Ir',
        link: { type: 'anchor', value: '' },
      }),
    ])
  })

  it('falls back to a titled page when nothing converts', () => {
    const result = convertLandingPage({
      title: 'Minha página',
      templateKey: 'saas',
      sections: [],
    })
    expect(result.header).toBeNull()
    expect(props(result.page, 'site.heading')).toEqual([
      expect.objectContaining({ text: 'Minha página', level: 'h1' }),
    ])
    expect(validateSiteDocument(result.page).ok).toBe(true)
  })
})
