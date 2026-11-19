import { describe, expect, it } from 'vitest'
import {
  searchDocument,
  searchInput,
  searchSettings,
  words,
} from '@/src/__tests__/factories/site-search.factory'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { heading, text } from '@/src/lib/canvas-site/presets/builder'
import { analyzeSearchPage } from '@/src/lib/sites/search/analyze'
import { extractPageContent } from '@/src/lib/sites/search/content'
import {
  analyzeKeyword,
  brokenLinks,
  buildTechnicalChecklist,
  cleanKeyword,
  countOccurrences,
  KEYWORD_DENSITY_MAX,
  overallScore,
  pageLinkTargets,
  snapshotDay,
  technicalSummary,
  worstPages,
} from '@/src/lib/sites/search/seo-overview'

function pageInput(
  id: string,
  title: string,
  html: string,
  seoTitle = title,
  description = '',
) {
  const document = searchDocument(heading('h1', title), text(html))
  const content = extractPageContent(document)
  return {
    id,
    title,
    path: `/${id}`,
    seoTitle,
    description,
    content,
    focusKeyword: null as string | null,
  }
}

describe('countOccurrences', () => {
  it('counts whole words, ignoring case and accents', () => {
    expect(
      countOccurrences(
        'Implante dentário e IMPLANTE dentario. Implantes',
        'implante dentário',
      ),
    ).toBe(2)
    expect(countOccurrences('dentistas', 'dentista')).toBe(0)
    expect(countOccurrences('texto', '')).toBe(0)
  })

  it('treats regex characters in the term literally', () => {
    expect(countOccurrences('C++ é bom. c++ também', 'c++')).toBe(2)
    expect(countOccurrences('preço (R$) final', 'preço (r$)')).toBe(1)
  })
})

describe('analyzeKeyword', () => {
  it('reports a term used nowhere as missing', () => {
    const report = analyzeKeyword({ id: 'k', term: 'clareamento' }, [
      pageInput('home', 'Início', `<p>${words(80)}</p>`),
    ])
    expect(report.status).toBe('missing')
    expect(report.pages).toEqual([])
    expect(report.gaps[0]).toMatch(/nenhuma página/)
  })

  it('says so when the site has no pages', () => {
    const report = analyzeKeyword({ id: 'k', term: 'x1' }, [])
    expect(report.gaps).toEqual(['O site ainda não tem páginas.'])
  })

  it('finds where the term appears and lists the remaining gaps', () => {
    const page = pageInput(
      'home',
      'Clareamento dental',
      `<p>O clareamento é rápido. ${words(120)}</p>`,
      'Clareamento dental | Sorriso',
      'Tudo sobre clareamento.',
    )
    const report = analyzeKeyword({ id: 'k', term: 'clareamento' }, [
      page,
      pageInput('sobre', 'Sobre', `<p>${words(60)}</p>`),
    ])
    expect(report.status).toBe('ok')
    expect(report.pages).toHaveLength(1)
    expect(report.pages[0]).toMatchObject({
      id: 'home',
      inTitle: true,
      inDescription: true,
      inH1: true,
      inHeadings: true,
    })
    expect(report.pages[0].count).toBeGreaterThanOrEqual(2)
    expect(report.gaps).toEqual([
      'Nenhuma página usa o termo como palavra-chave principal.',
    ])
  })

  it('marks the focus keyword and flags stuffing', () => {
    const stuffed = pageInput(
      'home',
      'Oferta',
      `<p>${Array.from({ length: 12 }, () => 'barato').join(' ')} ${words(100)}</p>`,
    )
    stuffed.focusKeyword = 'Barato'
    const report = analyzeKeyword({ id: 'k', term: 'barato' }, [stuffed])
    expect(report.pages[0].focus).toBe(true)
    expect(report.pages[0].density).toBeGreaterThan(KEYWORD_DENSITY_MAX)
    expect(report.status).toBe('dense')
  })

  it('is weak when it only appears in the body', () => {
    const report = analyzeKeyword({ id: 'k', term: 'implante' }, [
      pageInput('a', 'Serviços', `<p>Fazemos implante. ${words(300)}</p>`),
    ])
    expect(report.status).toBe('weak')
  })
})

describe('page links', () => {
  const document = {
    catalog: 'site',
    version: 1,
    rootId: 'root',
    nodes: {
      root: {
        id: 'root',
        type: 'site.page',
        props: {},
        children: ['a', 'b', 'c'],
      },
      a: {
        id: 'a',
        type: 'site.button',
        props: { link: { type: 'page', value: 'gone' } },
      },
      b: {
        id: 'b',
        type: 'site.button',
        props: { link: { type: 'page', value: 'home' } },
      },
      c: {
        id: 'c',
        type: 'site.button',
        props: { link: { type: 'page', value: 'gone2' } },
        meta: { hidden: true },
      },
    },
  } as unknown as CanvasDocument

  it('collects page targets and skips hidden nodes', () => {
    expect(pageLinkTargets(document).sort()).toEqual(['gone', 'home'])
  })

  it('reports links to pages that no longer exist', () => {
    expect(
      brokenLinks(
        [{ id: 'p', title: 'Início', document }],
        new Set(['home', 'p']),
      ),
    ).toEqual([{ id: 'p', title: 'Início', broken: 1 }])
    expect(
      brokenLinks(
        [{ id: 'p', title: 'Início', document }],
        new Set(['gone', 'home']),
      ),
    ).toEqual([])
  })
})

describe('buildTechnicalChecklist', () => {
  const analysis = analyzeSearchPage(
    searchInput({ seo: {}, document: searchDocument(text('<p>curto</p>')) }),
  )
  const pages = [{ id: 'p1', title: 'Página', path: '/p', analysis }]

  it('aggregates the page checks and the site files', () => {
    const items = buildTechnicalChecklist({
      pages,
      broken: [],
      settings: searchSettings(),
      published: true,
    })
    const byId = Object.fromEntries(items.map((item) => [item.id, item]))
    expect(byId['seo.h1'].status).toBe('fail')
    expect(byId['seo.h1'].pages).toEqual([{ id: 'p1', title: 'Página' }])
    expect(byId['seo.h1'].failed).toBe(1)
    expect(byId['links.broken'].status).toBe('pass')
    expect(byId['site.sitemap'].status).toBe('pass')
    expect(byId['site.robots'].scope).toBe('site')
    const summary = technicalSummary(items)
    expect(summary.total).toBe(items.length)
    expect(summary.pass + summary.warn + summary.fail).toBe(items.length)
  })

  it('warns for an unpublished site and fails for noindex', () => {
    const draft = buildTechnicalChecklist({
      pages,
      broken: [],
      settings: searchSettings(),
      published: false,
    })
    expect(draft.find((item) => item.id === 'site.sitemap')?.status).toBe(
      'warn',
    )

    const hidden = buildTechnicalChecklist({
      pages,
      broken: [{ id: 'p1', title: 'Página', broken: 2 }],
      settings: searchSettings({
        seo: { ...searchSettings().seo, noindex: true },
      }),
      published: true,
    })
    expect(hidden.find((item) => item.id === 'site.robots')?.status).toBe(
      'fail',
    )
    const broken = hidden.find((item) => item.id === 'links.broken')
    expect(broken?.status).toBe('fail')
    expect(broken?.detail).toMatch(/2 links quebrados em 1 página/)
  })

  it('handles a site without pages', () => {
    const items = buildTechnicalChecklist({
      pages: [],
      broken: [],
      settings: searchSettings(),
      published: false,
    })
    expect(items.find((item) => item.id === 'seo.h1')?.detail).toBe(
      'Nenhuma página para avaliar.',
    )
  })
})

describe('small helpers', () => {
  it('ranks the worst pages by mean score and ignores clean ones', () => {
    const rows = [
      {
        id: 'a',
        title: 'A',
        path: '/a',
        scores: { seo: 90, aeo: 90, geo: 90 },
        issues: 0,
      },
      {
        id: 'b',
        title: 'B',
        path: '/b',
        scores: { seo: 40, aeo: 50, geo: 60 },
        issues: 5,
      },
      {
        id: 'c',
        title: 'C',
        path: '/c',
        scores: { seo: 70, aeo: 70, geo: 70 },
        issues: 2,
      },
    ]
    expect(worstPages(rows).map((row) => row.id)).toEqual(['b', 'c'])
    expect(worstPages(rows, 1)).toHaveLength(1)
    expect(worstPages(rows)[0].score).toBe(50)
  })

  it('averages the pillars, normalizes days and cleans keywords', () => {
    expect(overallScore({ seo: 90, aeo: 60, geo: 30 })).toBe(60)
    expect(snapshotDay(new Date('2026-11-19T22:30:00Z')).toISOString()).toBe(
      '2026-11-19T00:00:00.000Z',
    )
    expect(cleanKeyword('  clínica   odontológica ')).toBe(
      'clínica odontológica',
    )
  })
})
