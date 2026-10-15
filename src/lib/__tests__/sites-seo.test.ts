import { describe, expect, it } from 'vitest'
import {
  createFakeSitePage,
  createFakeSnapshot,
} from '@/src/__tests__/factories/site.factory'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  absoluteUrl,
  breadcrumbOf,
  canonicalUrlOf,
  fallbackFavicon,
  faqOf,
  serializeJsonLd,
  siteJsonLd,
  socialImageOf,
} from '@/src/lib/sites/seo'
import { buildSiteSnapshot, type SiteSnapshot } from '@/src/lib/sites/snapshot'

const BASE = 'https://app.steel/s/clinica'

function snapshot(settings: Record<string, unknown> = {}): SiteSnapshot {
  const home = createFakeSitePage({
    id: 'home',
    title: 'Início',
    path: 'inicio',
    isHome: true,
  })
  const servicos = createFakeSitePage({
    id: 'servicos',
    title: 'Serviços',
    slug: 'servicos',
    path: 'servicos',
    position: 1,
    seo: { title: 'Nossos serviços', description: 'O que fazemos' },
  })
  const exames = createFakeSitePage({
    id: 'exames',
    parentId: 'servicos',
    title: 'Exames',
    slug: 'exames',
    path: 'servicos/exames',
    position: 2,
    seo: {
      canonicalUrl: 'https://outro.com/exames',
      socialImageUrl: '/media/exames.png',
    },
  })
  return buildSiteSnapshot({
    name: 'Clínica <São Lucas>',
    theme: {},
    settings,
    homePageId: 'home',
    pages: [home, servicos, exames],
    globals: [],
  })
}

const page = (snap: SiteSnapshot, id: string) =>
  snap.pages.find((item) => item.id === id) as SiteSnapshot['pages'][number]

describe('site SEO', () => {
  it('resolves absolute URLs on the app origin', () => {
    expect(absoluteUrl('/media/a.png', BASE)).toBe(
      'https://app.steel/media/a.png',
    )
    expect(absoluteUrl('https://cdn.x/a.png', BASE)).toBe('https://cdn.x/a.png')
    expect(absoluteUrl('http://[bad', BASE)).toBe('http://[bad')
  })

  it('uses the canonical override or the page address', () => {
    const snap = snapshot()
    expect(canonicalUrlOf(snap, page(snap, 'home'), BASE)).toBe(BASE)
    expect(canonicalUrlOf(snap, page(snap, 'servicos'), BASE)).toBe(
      `${BASE}/servicos`,
    )
    expect(canonicalUrlOf(snap, page(snap, 'exames'), BASE)).toBe(
      'https://outro.com/exames',
    )
  })

  it('picks the page image, the site image or the generated card', () => {
    const snap = snapshot({ socialImageUrl: 'https://cdn.x/site.png' })
    expect(socialImageOf(snap, page(snap, 'exames'), BASE)).toEqual({
      url: 'https://app.steel/media/exames.png',
      generated: false,
    })
    expect(socialImageOf(snap, page(snap, 'home'), BASE).url).toBe(
      'https://cdn.x/site.png',
    )
    const bare = snapshot()
    expect(socialImageOf(bare, page(bare, 'servicos'), BASE)).toEqual({
      url: `${BASE}/_og?page=servicos`,
      generated: true,
    })
  })

  it('builds the breadcrumb from the home page down', () => {
    const snap = snapshot()
    expect(
      breadcrumbOf(snap, page(snap, 'exames')).map((item) => item.id),
    ).toEqual(['home', 'servicos', 'exames'])
    expect(breadcrumbOf(snap, page(snap, 'home')).map((p) => p.id)).toEqual([
      'home',
    ])
    // A parent cycle (corrupted data) stops instead of looping.
    const looped: SiteSnapshot = {
      ...snap,
      homePageId: null,
      pages: snap.pages.map((item) =>
        item.id === 'servicos' ? { ...item, parentId: 'exames' } : item,
      ),
    }
    expect(
      breadcrumbOf(looped, page(looped, 'exames')).map((p) => p.id),
    ).toEqual(['home', 'servicos', 'exames'])
    const homeless = createFakeSnapshot({ homePageId: null, pages: [] })
    const lonely = page(snap, 'servicos')
    expect(breadcrumbOf(homeless, lonely)).toEqual([lonely])
  })

  it('describes the page as an Organization/WebSite/WebPage/BreadcrumbList graph', () => {
    const snap = snapshot({
      faviconUrl: '/media/icon.png',
      seo: {
        description: 'Saúde',
        organizationName: 'Clínica SL Ltda.',
        sameAs: ['https://instagram.com/clinica'],
      },
    })
    const graph = siteJsonLd(snap, page(snap, 'exames'), BASE) as {
      '@graph': Array<Record<string, unknown>>
    }
    const [organization, website, webPage, breadcrumb] = graph['@graph']
    expect(organization).toMatchObject({
      '@type': 'Organization',
      name: 'Clínica SL Ltda.',
      logo: 'https://app.steel/media/icon.png',
      sameAs: ['https://instagram.com/clinica'],
    })
    expect(website).toMatchObject({ '@type': 'WebSite', inLanguage: 'pt-BR' })
    expect(webPage).toMatchObject({
      '@type': 'WebPage',
      url: `${BASE}/servicos/exames`,
      description: 'Saúde',
    })
    expect(
      (breadcrumb.itemListElement as Array<{ name: string }>).map(
        (item) => item.name,
      ),
    ).toEqual(['Início', 'Nossos serviços', 'Exames'])

    const plain = snapshot()
    const bare = siteJsonLd(plain, page(plain, 'home'), BASE) as {
      '@graph': Array<Record<string, unknown>>
    }
    expect(bare['@graph'][0]).not.toHaveProperty('logo')
    expect(bare['@graph'][0]).not.toHaveProperty('sameAs')
    expect(bare['@graph'][0].name).toBe('Clínica <São Lucas>')
    expect(bare['@graph'][2]).not.toHaveProperty('description')
  })

  it('serializes JSON-LD that cannot close its script', () => {
    const json = serializeJsonLd({ name: '</script><b>  ' })
    expect(json).not.toContain('<')
    expect(json).toContain('\\u2028')
    expect(json).toContain('\\u2029')
    expect(JSON.parse(json).name).toBe('</script><b>  ')
  })

  it('draws a fallback favicon with the site initial', () => {
    const icon = decodeURIComponent(fallbackFavicon('clínica', '#0f766e'))
    expect(icon).toContain('data:image/svg+xml')
    expect(icon).toContain('fill="#0f766e"')
    expect(icon).toContain('>C</text>')
    expect(decodeURIComponent(fallbackFavicon('<x', 'red'))).toContain(
      'fill="#1d4ed8"',
    )
    expect(decodeURIComponent(fallbackFavicon('  ', '#000'))).toContain(
      '>S</text>',
    )
    expect(decodeURIComponent(fallbackFavicon('&', '#000'))).toContain(
      '>S</text>',
    )
  })

  it('adds a FAQPage built from the page accordions', () => {
    const faqDoc: CanvasDocument = {
      catalog: 'site',
      version: 1,
      rootId: 'root',
      nodes: {
        root: { id: 'root', type: 'site.page', props: {}, children: ['s'] },
        s: { id: 's', type: 'site.section', props: {}, children: ['acc'] },
        acc: {
          id: 'acc',
          type: 'site.accordion',
          props: {},
          children: ['q1', 'q2', 'q3', 'q4'],
        },
        q1: {
          id: 'q1',
          type: 'site.accordion-item',
          props: { title: ' Atende convênio? ' },
          children: ['a1', 'l1', 'h1', 'gone', 'missing'],
        },
        a1: {
          id: 'a1',
          type: 'site.text',
          props: { html: '<p>Sim, os <b>principais</b>.</p>' },
        },
        l1: {
          id: 'l1',
          type: 'site.list',
          props: { items: [{ text: 'Unimed' }, null, { text: 'Amil' }] },
        },
        h1: { id: 'h1', type: 'site.heading', props: { text: 'Fim' } },
        gone: {
          id: 'gone',
          type: 'site.text',
          props: { html: '<p>oculto</p>' },
          meta: { hidden: true },
        },
        q2: {
          id: 'q2',
          type: 'site.accordion-item',
          props: { title: 'Sem resposta' },
          children: [],
        },
        q3: {
          id: 'q3',
          type: 'site.accordion-item',
          props: { title: 'Oculta' },
          children: ['a1'],
          meta: { hidden: true },
        },
        q4: {
          id: 'q4',
          type: 'site.accordion-item',
          props: {},
          children: ['a1'],
        },
      },
    }
    expect(faqOf(faqDoc)).toEqual([
      {
        question: 'Atende convênio?',
        answer: 'Sim, os principais. Unimed Amil Fim',
      },
    ])

    const base = snapshot()
    const withFaq: SiteSnapshot = {
      ...base,
      pages: base.pages.map((item) =>
        item.id === 'home' ? { ...item, document: faqDoc } : item,
      ),
    }
    const graph = siteJsonLd(withFaq, page(withFaq, 'home'), BASE) as {
      '@graph': Array<Record<string, unknown>>
    }
    expect(graph['@graph'][4]).toMatchObject({
      '@type': 'FAQPage',
      '@id': `${BASE}#faq`,
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Atende convênio?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Sim, os principais. Unimed Amil Fim',
          },
        },
      ],
    })
    expect(siteJsonLd(base, page(base, 'home'), BASE)['@graph']).toHaveLength(4)
  })
})
