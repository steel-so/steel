import { describe, expect, it } from 'vitest'
import {
  createFakeSitePage,
  createFakeSnapshot,
} from '@/src/__tests__/factories/site.factory'
import {
  buildSiteRouteIndex,
  decideSiteRoute,
  isSiteFilePath,
  siteNotFoundHtml,
  UNPUBLISHED_ROUTE_INDEX,
} from '@/src/lib/sites/route-index'
import { buildSiteSnapshot } from '@/src/lib/sites/snapshot'

const snapshot = buildSiteSnapshot({
  name: 'Clínica',
  theme: {},
  settings: {},
  homePageId: 'home',
  pages: [
    createFakeSitePage({ id: 'home', path: 'inicio', isHome: true }),
    createFakeSitePage({ id: 'c', path: 'sobre/contato', position: 1 }),
  ],
  globals: [],
})

describe('site route index', () => {
  const index = buildSiteRouteIndex(snapshot, [
    { fromPath: '/contato', toPath: '/sobre/contato', permanent: true },
    { fromPath: '/sobre/contato', toPath: '/x', permanent: false },
  ])

  it('lists the public paths (the home page at the root)', () => {
    expect(index.paths).toEqual(['/', '/sobre/contato'])
    expect(createFakeSnapshot().pages).toHaveLength(1)
  })

  it('decides redirects first, then pages, else not found', () => {
    expect(decideSiteRoute(index, '/Contato/')).toEqual({
      kind: 'redirect',
      location: '/sobre/contato',
      permanent: true,
    })
    expect(decideSiteRoute(index, '/sobre/contato').kind).toBe('redirect')
    expect(decideSiteRoute(index, '/')).toEqual({ kind: 'page' })
    expect(decideSiteRoute(index, '/inicio')).toEqual({ kind: 'not-found' })
    expect(decideSiteRoute(UNPUBLISHED_ROUTE_INDEX, '/')).toEqual({
      kind: 'not-found',
    })
  })

  it('recognizes the runtime files', () => {
    expect(isSiteFilePath('/sitemap.xml')).toBe(true)
    expect(isSiteFilePath('/_og')).toBe(true)
    expect(isSiteFilePath('/robots.txt')).toBe(true)
    expect(isSiteFilePath('/contato')).toBe(false)
  })

  it('renders a standalone 404 page', () => {
    const html = siteNotFoundHtml({ siteName: 'A <b>', homeHref: '/s/a' })
    expect(html).toContain('<html lang="pt-BR">')
    expect(html).toContain('Página não encontrada | A &lt;b&gt;')
    expect(html).toContain('href="/s/a"')
    expect(html).toContain('noindex')
    expect(html).not.toContain('<script')
    const bare = siteNotFoundHtml({})
    expect(bare).toContain('<title>Página não encontrada</title>')
    expect(bare).not.toContain('<a ')
    expect(index.name).toBe('Clínica')
  })
})
