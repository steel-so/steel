import { describe, expect, it } from 'vitest'
import {
  parseSiteHost,
  resolveSiteHref,
  siteBaseUrl,
  siteLinkBase,
  sitePageUrl,
  siteRewritePath,
  siteSlugFromPath,
} from '@/src/lib/sites/host'

describe('site host routing', () => {
  it('reads the slug of a site subdomain', () => {
    expect(parseSiteHost('clinica.sites.steel.app', 'sites.steel.app')).toBe(
      'clinica',
    )
    expect(
      parseSiteHost('Clinica.Sites.Steel.App:443', '.sites.steel.app.'),
    ).toBe('clinica')
  })

  it.each([
    [null, 'sites.steel.app'],
    ['clinica.sites.steel.app', undefined],
    ['clinica.sites.steel.app', '...'],
    ['sites.steel.app', 'sites.steel.app'],
    ['app.steel.app', 'sites.steel.app'],
    ['a.b.sites.steel.app', 'sites.steel.app'],
    ['www.sites.steel.app', 'sites.steel.app'],
    ['x.sites.steel.app', 'sites.steel.app'],
  ])('ignores host %s under %s', (host, root) => {
    expect(parseSiteHost(host, root)).toBeNull()
  })

  it('rewrites site paths and lets assets and APIs through', () => {
    expect(siteRewritePath('clinica', '/')).toBe('/s/clinica')
    expect(siteRewritePath('clinica', '/contato')).toBe('/s/clinica/contato')
    expect(siteRewritePath('clinica', '/sitemap.xml')).toBe(
      '/s/clinica/sitemap.xml',
    )
    expect(siteRewritePath('clinica', '/_next/static/a.js')).toBeNull()
    expect(siteRewritePath('clinica', '/api/sites/clinica/views')).toBeNull()
    expect(siteRewritePath('clinica', '/media/a.png')).toBeNull()
  })

  it('builds the public base URL', () => {
    expect(
      siteBaseUrl('clinica', {
        appUrl: 'https://app.steel.app',
        rootDomain: 'sites.steel.app',
      }),
    ).toBe('https://clinica.sites.steel.app')
    expect(
      siteBaseUrl('clinica', {
        appUrl: 'http://localhost:3001',
        rootDomain: 'lvh.me',
      }),
    ).toBe('http://clinica.lvh.me:3001')
    expect(siteBaseUrl('clinica', { appUrl: 'https://app.steel.app/' })).toBe(
      'https://app.steel.app/s/clinica',
    )
    expect(
      siteBaseUrl('clinica', {
        appUrl: 'https://app.steel.app',
        rootDomain: '',
      }),
    ).toBe('https://app.steel.app/s/clinica')
  })

  it('builds page URLs and link bases', () => {
    expect(sitePageUrl('https://x.app/s/a', '')).toBe('https://x.app/s/a')
    expect(sitePageUrl('https://x.app/s/a', 'contato')).toBe(
      'https://x.app/s/a/contato',
    )
    expect(siteLinkBase('clinica', true)).toBe('')
    expect(siteLinkBase('clinica', false)).toBe('/s/clinica')
  })

  it('resolves internal links against the link base', () => {
    expect(resolveSiteHref('/contato', '/s/clinica')).toBe('/s/clinica/contato')
    expect(resolveSiteHref('/', '')).toBe('/')
    expect(resolveSiteHref('#precos', '/s/clinica')).toBe('#precos')
    expect(resolveSiteHref('//evil.com', '/s/clinica')).toBe('//evil.com')
    expect(resolveSiteHref('https://x.com', '')).toBe('https://x.com')
  })

  it('reads the slug of a path-based site request', () => {
    expect(siteSlugFromPath('/s/clinica')).toBe('clinica')
    expect(siteSlugFromPath('/s/clinica/contato')).toBe('clinica')
    expect(siteSlugFromPath('/s/AB')).toBeNull()
    expect(siteSlugFromPath('/sign-in')).toBeNull()
  })
})
