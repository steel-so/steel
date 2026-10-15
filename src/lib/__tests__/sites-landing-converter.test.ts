import { describe, expect, it } from 'vitest'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { validateSiteDocument } from '@/src/lib/sites/document'
import {
  convertLandingPage,
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

describe('convertLandingPage', () => {
  it.each([
    ['full', FULL],
    ['minimal', MINIMAL],
  ])(
    'converts every section type (%s) into valid site documents',
    (_label, contents) => {
      const result = convertLandingPage({
        title: 'Clínica',
        templateKey: 'agency',
        sections: sections(contents),
      })
      expect(result.skipped).toBe(0)
      for (const doc of [result.page, result.header, result.footer]) {
        expect(doc && validateSiteDocument(doc).ok).toBe(true)
      }
      const anchors = props(result.page, 'site.section').map((p) => p.anchorId)
      expect(anchors).toContain('servicos')
      expect(anchors).not.toContain('cabecalho')
      expect(
        props(result.header as CanvasDocument, 'site.section')[0].anchorId,
      ).toBe('cabecalho')
      expect(
        props(result.footer as CanvasDocument, 'site.section')[0].anchorId,
      ).toBe('rodape')
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
    expect(props(result.page, 'site.form')).toEqual([{ formId: 'form-1' }])
    expect(props(result.page, 'site.heading')).toContainEqual({
      text: 'Cuidamos de você',
      level: 1,
    })
    expect(props(result.page, 'site.text')).toContainEqual({
      text: 'R$ 50 (de R$ 70)',
      variant: 'lead',
    })
    expect(props(result.page, 'site.text')).toContainEqual({
      text: 'Ana — Paciente',
      variant: 'small',
    })
    expect(props(result.page, 'site.section')).toContainEqual({
      anchorId: 'depoimentos',
      tone: 'accent',
    })
    expect(props(result.header as CanvasDocument, 'site.menu')).toEqual([
      { source: 'links', links: [link] },
    ])
    expect(props(result.footer as CanvasDocument, 'site.social')).toHaveLength(
      1,
    )
    expect(props(result.page, 'site.button')).toContainEqual({
      label: 'Assinar',
      href: '/assinar',
      variant: 'primary',
    })
  })

  it('keeps a second header/footer inline and skips disabled or broken sections', () => {
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
    expect(props(result.page, 'site.section').map((p) => p.anchorId)).toEqual([
      'destaque',
      'cabecalho-2',
    ])
    expect(props(result.page, 'site.button')).toEqual([
      { label: 'Ir', href: '#', variant: 'primary' },
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
      { text: 'Minha página', level: 1 },
    ])
    expect(validateSiteDocument(result.page).ok).toBe(true)
  })
})
