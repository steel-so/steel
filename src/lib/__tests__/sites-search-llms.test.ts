import { describe, expect, it } from 'vitest'
import {
  searchDocument,
  searchSettings,
  words,
} from '@/src/__tests__/factories/site-search.factory'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import { heading, spec, text } from '@/src/lib/canvas-site/presets/builder'
import {
  llmsEnabled,
  llmsPages,
  renderLlmsFullTxt,
  renderLlmsTxt,
} from '@/src/lib/sites/search/llms'
import { siteJsonLd } from '@/src/lib/sites/seo'
import {
  buildSiteSnapshot,
  type SiteSnapshot,
  type SiteSnapshotPage,
} from '@/src/lib/sites/snapshot'
import type { SiteSettingsDTO } from '@/src/schemas/site.schema'
import type { SitePageSeoDTO } from '@/src/schemas/site-page.schema'

const BASE = 'https://clinica.sites.test'

function page(
  id: string,
  overrides: Partial<SiteSnapshotPage> & { seo?: SitePageSeoDTO } = {},
): SiteSnapshotPage {
  return {
    id,
    parentId: null,
    title: id === 'home' ? 'Início' : 'Implante',
    slug: id,
    path: id,
    position: 0,
    isHome: id === 'home',
    seo: {},
    document: searchDocument(heading('h1', 'Título'), text('<p>Texto.</p>')),
    ...overrides,
  }
}

function snapshot(
  pages: SiteSnapshotPage[],
  settings: SiteSettingsDTO = searchSettings(),
): SiteSnapshot {
  return {
    snapshotVersion: 1,
    name: 'Clínica Sorriso',
    theme: {},
    settings,
    homePageId: 'home',
    pages,
    globals: [],
  }
}

const PROFILE_SETTINGS = searchSettings({
  search: {
    business: {
      type: 'Dentist',
      name: 'Clínica Sorriso',
      legalName: 'Sorriso Ltda',
      description: 'Clínica odontológica\nem Pinheiros [SP].',
      category: 'Odontologia',
      address: { street: 'Rua A, 1', city: 'São Paulo', region: 'SP' },
      phone: '(11) 3333-4444',
      email: 'oi@sorriso.com',
      hours: [{ days: ['Monday'], opens: '08:00', closes: '18:00' }],
      serviceArea: ['São Paulo'],
      foundingYear: 2010,
      priceRange: '$$',
      people: [{ name: 'Dra. Ana', role: 'Diretora' }, { name: 'Dr. Beto' }],
      sameAs: ['https://instagram.com/sorriso'],
    },
    crawlers: {},
    llms: { enabled: true, notes: 'Destaque o atendimento de urgência.' },
    indexNow: { enabled: false },
    verification: {},
  },
})

describe('llms.txt', () => {
  const faqDoc = searchDocument(
    heading('h1', 'Implante'),
    heading('h2', 'Etapas'),
    text(`<p>${words(5)}</p>`),
    spec(SITE_TYPES.accordion, {}, [
      spec(SITE_TYPES.accordionItem, { title: 'Dói?' }, [text('<p>Não.</p>')]),
    ]),
  )
  const site = snapshot(
    [
      page('home', { seo: { description: 'Página inicial.' } }),
      page('implante', {
        document: faqDoc,
        updatedAt: '2026-10-01T10:00:00.000Z',
        seo: {
          title: 'Implante dentário',
          search: {
            summary: 'Implante com garantia de 10 anos.',
            questions: [
              { question: 'dói?', answer: 'Repetida' },
              { question: 'Quanto custa?', answer: 'A partir de R$ 2.000.' },
              { question: 'Sem resposta', answer: '' },
            ],
          },
        },
      }),
      page('oculta', { seo: { noindex: true } }),
      page('copia', { seo: { canonicalUrl: 'https://outro.com/x' } }),
      page('propria', { seo: { canonicalUrl: `${BASE}/propria` } }),
    ],
    PROFILE_SETTINGS,
  )

  it('lists indexable pages canonical to themselves', () => {
    expect(llmsPages(site, BASE).map((item) => item.url)).toEqual([
      BASE,
      `${BASE}/implante`,
      `${BASE}/propria`,
    ])
  })

  it('renders the summary, facts, pages and questions', () => {
    const txt = renderLlmsTxt(site, BASE)
    expect(txt).toContain(
      '# Clínica Sorriso\n\n> Clínica odontológica em Pinheiros SP.\n\nDestaque o atendimento de urgência.',
    )
    expect(txt).toContain('- Endereço: Rua A, 1 · São Paulo/SP')
    expect(txt).toContain('- Pessoas: Dra. Ana (Diretora), Dr. Beto')
    expect(txt).toContain('- Fundação: 2010')
    expect(txt).toContain(`- [Início](${BASE}): Página inicial.`)
    expect(txt).toContain(
      `- [Implante dentário](${BASE}/implante): Implante com garantia de 10 anos.`,
    )
    expect(txt).toContain(`- [Implante](${BASE}/propria)\n`)
    expect(txt).toContain(
      '## Perguntas frequentes\n\n- Dói? Não.\n- Quanto custa? A partir de R$ 2.000.\n',
    )
    expect(txt).not.toContain('Repetida')
    expect(txt).toContain(`- [Conteúdo completo](${BASE}/llms-full.txt)`)
  })

  it('renders the full text of every page', () => {
    const full = renderLlmsFullTxt(site, BASE)
    expect(full).toContain(
      `## Implante dentário\n\nURL: ${BASE}/implante\nAtualizado em: 2026-10-01\n\n> Implante com garantia de 10 anos.`,
    )
    expect(full).toContain('### Implante\n\n#### Etapas\n\ntexto texto')
    expect(full).toContain('**Dói?**\n\nNão.')
    expect(full).not.toContain('URL: https://outro.com')
  })

  it('truncates past the size limit', () => {
    const full = renderLlmsFullTxt(site, BASE, 600)
    expect(full).toContain('[Conteúdo truncado')
    expect(full).not.toContain('## Implante dentário')
  })

  it('works with a bare site', () => {
    const bare = snapshot([], searchSettings())
    expect(renderLlmsTxt(bare, BASE)).toBe(
      `# Clínica Sorriso\n\n## Fatos\n\n- Nome: Clínica Sorriso\n\n## Opcional\n\n- [Conteúdo completo](${BASE}/llms-full.txt): texto de todas as páginas\n- [Sitemap](${BASE}/sitemap.xml)\n`,
    )
    expect(llmsEnabled(bare)).toBe(true)
    expect(
      llmsEnabled(snapshot([], searchSettings({ seo: { noindex: true } }))),
    ).toBe(false)
    expect(
      llmsEnabled(
        snapshot([], {
          ...PROFILE_SETTINGS,
          search: {
            ...(PROFILE_SETTINGS.search as NonNullable<
              SiteSettingsDTO['search']
            >),
            llms: { enabled: false },
          },
        }),
      ),
    ).toBe(false)
  })
})

describe('JSON-LD with the search data', () => {
  it('publishes the business profile, freshness, speakable and items', () => {
    const target = page('implante', {
      updatedAt: '2026-10-01T10:00:00.000Z',
      seo: {
        description: 'Desc',
        search: {
          summary: 'Resumo.',
          speakable: true,
          structuredData: [
            { type: 'Service', name: 'Implante' },
            { type: 'FAQPage' },
          ],
        },
      },
    })
    const graph = siteJsonLd(
      snapshot([page('home'), target], PROFILE_SETTINGS),
      target,
      BASE,
    )['@graph'] as Array<Record<string, unknown>>
    expect(graph[0]).toMatchObject({
      '@type': 'Dentist',
      telephone: '(11) 3333-4444',
    })
    expect(graph[2]).toMatchObject({
      '@type': 'WebPage',
      dateModified: '2026-10-01T10:00:00.000Z',
      abstract: 'Resumo.',
      speakable: { '@type': 'SpeakableSpecification' },
    })
    expect(graph.at(-1)).toMatchObject({
      '@type': 'Service',
      '@id': `${BASE}/implante#service-1`,
    })
  })

  it('makes a plain organization local when the page asks for LocalBusiness', () => {
    const target = page('home', {
      seo: { search: { structuredData: [{ type: 'LocalBusiness' }] } },
    })
    const graph = siteJsonLd(
      snapshot([target], searchSettings({ faviconUrl: '/fav.png' })),
      target,
      BASE,
    )['@graph'] as Array<Record<string, unknown>>
    expect(graph[0]).toMatchObject({
      '@type': 'LocalBusiness',
      logo: `${BASE}/fav.png`,
    })
    const dentist = siteJsonLd(
      snapshot([target], PROFILE_SETTINGS),
      target,
      BASE,
    )['@graph'] as Array<Record<string, unknown>>
    expect(dentist[0]['@type']).toBe('Dentist')
  })
})

describe('snapshot freshness', () => {
  it('records the page edit date when the row has one', () => {
    const built = buildSiteSnapshot({
      name: 'S',
      theme: {},
      settings: {},
      homePageId: null,
      globals: [],
      pages: [
        { ...page('a'), updatedAt: new Date('2026-10-01T00:00:00Z') },
        { ...page('b'), updatedAt: undefined },
      ],
    })
    expect(built.pages[0].updatedAt).toBe('2026-10-01T00:00:00.000Z')
    expect(built.pages[1]).not.toHaveProperty('updatedAt')
  })
})
