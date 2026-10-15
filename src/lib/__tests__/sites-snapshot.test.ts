import { describe, expect, it } from 'vitest'
import {
  createFakeSitePage,
  createSiteDocument,
} from '@/src/__tests__/factories/site.factory'
import {
  buildSiteSnapshot,
  findSnapshotPage,
  globalOf,
  indexablePages,
  pageTitle,
  parseSiteSnapshot,
  publicPathOf,
  renderRobotsTxt,
  renderSitemapXml,
  type SiteSnapshot,
} from '@/src/lib/sites/snapshot'

function snapshot(overrides?: Partial<SiteSnapshot>): SiteSnapshot {
  return {
    ...buildSiteSnapshot({
      name: 'Clínica',
      theme: null,
      settings: { seo: { titleTemplate: '%s | Clínica' } },
      homePageId: 'home',
      pages: [
        createFakeSitePage({
          id: 'contato',
          slug: 'contato',
          path: 'contato',
          position: 2,
          title: 'Contato',
          seo: { title: 'Fale conosco' },
        }),
        createFakeSitePage({
          id: 'home',
          isHome: true,
          position: 0,
          title: 'Início',
        }),
        createFakeSitePage({
          id: 'sub',
          parentId: 'contato',
          slug: 'mapa',
          path: 'contato/mapa',
          position: 3,
          seo: { noindex: true },
        }),
      ],
      globals: [
        {
          id: 'g1',
          kind: 'FOOTER',
          name: 'Rodapé',
          document: createSiteDocument(),
        },
      ],
    }),
    ...overrides,
  }
}

describe('site snapshot', () => {
  it('builds a sorted snapshot with parsed settings and seo', () => {
    const snap = snapshot()
    expect(snap.snapshotVersion).toBe(1)
    expect(snap.theme).toEqual({})
    expect(snap.pages.map((page) => page.id)).toEqual([
      'home',
      'contato',
      'sub',
    ])
    expect(snap.settings.cookieBanner).toEqual({ enabled: false })
    expect(snap.pages[1].seo).toEqual({ title: 'Fale conosco' })
  })

  it('round-trips through JSON and rejects foreign data', () => {
    const snap = snapshot()
    const parsed = parseSiteSnapshot(JSON.parse(JSON.stringify(snap)))
    expect(parsed.ok && parsed.value).toEqual(snap)
    expect(parseSiteSnapshot({ snapshotVersion: 2 }).ok).toBe(false)
    expect(parseSiteSnapshot(null).ok).toBe(false)
  })

  it('finds pages by path and the home page by id, flag or order', () => {
    const snap = snapshot()
    expect(findSnapshotPage(snap, [])?.id).toBe('home')
    expect(findSnapshotPage(snap, ['Contato', 'mapa'])?.id).toBe('sub')
    expect(findSnapshotPage(snap, ['nope'])).toBeNull()
    expect(findSnapshotPage({ ...snap, homePageId: null }, [])?.id).toBe('home')
    const noFlag = {
      ...snap,
      homePageId: 'gone',
      pages: snap.pages.map((page) => ({ ...page, isHome: false })),
    }
    expect(findSnapshotPage(noFlag, [])?.id).toBe('home')
    expect(findSnapshotPage({ ...snap, pages: [] }, [])).toBeNull()
  })

  it('serves the home page at the root', () => {
    const snap = snapshot()
    expect(publicPathOf(snap, snap.pages[0])).toBe('')
    expect(publicPathOf(snap, snap.pages[1])).toBe('contato')
  })

  it('finds globals by kind', () => {
    const snap = snapshot()
    expect(globalOf(snap, 'FOOTER')?.id).toBe('g1')
    expect(globalOf(snap, 'HEADER')).toBeNull()
  })

  it('lists indexable pages', () => {
    const snap = snapshot()
    expect(indexablePages(snap).map((page) => page.id)).toEqual([
      'home',
      'contato',
    ])
    const hidden = {
      ...snap,
      settings: { ...snap.settings, seo: { noindex: true } },
    }
    expect(indexablePages(hidden)).toEqual([])
  })

  it('applies the title template', () => {
    const snap = snapshot()
    expect(pageTitle(snap, snap.pages[1])).toBe('Fale conosco | Clínica')
    const plain = { ...snap, settings: { ...snap.settings, seo: {} } }
    expect(pageTitle(plain, snap.pages[0])).toBe('Início')
  })

  it('renders sitemap.xml and robots.txt', () => {
    const xml = renderSitemapXml([
      {
        loc: 'https://a.app/s/x?a=1&b=<2>"\'',
        lastModified: new Date('2026-10-14T00:00:00Z'),
      },
    ])
    expect(xml).toContain(
      '<loc>https://a.app/s/x?a=1&amp;b=&lt;2&gt;&quot;&apos;</loc>',
    )
    expect(xml).toContain('<lastmod>2026-10-14T00:00:00.000Z</lastmod>')
    expect(
      renderRobotsTxt({ noindex: false, sitemapUrl: 'https://a/s.xml' }),
    ).toBe('User-agent: *\nAllow: /\n\nSitemap: https://a/s.xml\n')
    expect(renderRobotsTxt({ noindex: true, sitemapUrl: '' })).toBe(
      'User-agent: *\nDisallow: /\n',
    )
  })
})
