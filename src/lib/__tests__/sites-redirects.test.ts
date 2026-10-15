import { describe, expect, it } from 'vitest'
import {
  applyRedirect,
  createsRedirectLoop,
  isValidRedirectTarget,
  matchRedirect,
  normalizeRedirectSource,
  normalizeSitePath,
  type SiteRedirectRule,
} from '@/src/lib/sites/redirects'

const rule = (
  fromPath: string,
  toPath: string,
  permanent = true,
): SiteRedirectRule => ({ fromPath, toPath, permanent })

describe('normalizeSitePath', () => {
  it('lower-cases, drops query, fragment and extra slashes', () => {
    expect(normalizeSitePath('/Blog//Post/?x=1#top')).toBe('/blog/post')
    expect(normalizeSitePath('contato')).toBe('/contato')
    expect(normalizeSitePath('/')).toBe('/')
    expect(normalizeSitePath('///')).toBe('/')
    expect(normalizeSitePath('')).toBe('/')
  })
})

describe('normalizeRedirectSource', () => {
  it('accepts exact paths and prefixes', () => {
    expect(normalizeRedirectSource(' /Antigo/ ')).toBe('/antigo')
    expect(normalizeRedirectSource('/blog/*')).toBe('/blog/*')
    expect(normalizeRedirectSource('/Blog//*')).toBe('/blog/*')
    expect(normalizeRedirectSource('/a.html')).toBe('/a.html')
  })

  it('rejects relative, protocol-relative, reserved and odd paths', () => {
    expect(normalizeRedirectSource('antigo')).toBeNull()
    expect(normalizeRedirectSource('//evil.com')).toBeNull()
    expect(normalizeRedirectSource('/')).toBeNull()
    expect(normalizeRedirectSource('/*')).toBeNull()
    expect(normalizeRedirectSource('/sitemap.xml')).toBeNull()
    expect(normalizeRedirectSource('/_og')).toBeNull()
    expect(normalizeRedirectSource('/com espaço')).toBeNull()
    expect(normalizeRedirectSource('/a*b')).toBeNull()
  })
})

describe('isValidRedirectTarget', () => {
  it('accepts site paths and http(s) URLs only', () => {
    expect(isValidRedirectTarget('/novo')).toBe(true)
    expect(isValidRedirectTarget('/novo#form?x=1')).toBe(true)
    expect(isValidRedirectTarget('https://exemplo.com/x')).toBe(true)
    expect(isValidRedirectTarget('http://exemplo.com')).toBe(true)
    expect(isValidRedirectTarget('https://exemplo.com/a b')).toBe(false)
    expect(isValidRedirectTarget('//exemplo.com')).toBe(false)
    expect(isValidRedirectTarget('javascript:alert(1)')).toBe(false)
    expect(isValidRedirectTarget('novo')).toBe(false)
    expect(isValidRedirectTarget('/a b')).toBe(false)
  })
})

describe('applyRedirect / matchRedirect', () => {
  it('matches exact sources', () => {
    expect(applyRedirect(rule('/a', '/b'), '/a')).toBe('/b')
    expect(applyRedirect(rule('/a', '/b'), '/a/c')).toBeNull()
  })

  it('carries the rest of the path for prefix targets', () => {
    const blog = rule('/blog/*', '/novidades/*')
    expect(applyRedirect(blog, '/blog/a/b')).toBe('/novidades/a/b')
    expect(applyRedirect(blog, '/blog')).toBe('/novidades')
    expect(applyRedirect(blog, '/blogger')).toBeNull()
    expect(applyRedirect(rule('/blog/*', '/'), '/blog/x')).toBe('/')
    expect(applyRedirect(rule('/x/*', '/*'), '/x')).toBe('/')
  })

  it('prefers exact sources, then the longest prefix', () => {
    const rules = [
      rule('/blog/*', '/a', false),
      rule('/blog/2024/*', '/b'),
      rule('/blog/2024/x', '/c'),
    ]
    expect(matchRedirect(rules, '/Blog/2024/X/')).toEqual({
      location: '/c',
      permanent: true,
    })
    expect(matchRedirect(rules, '/blog/2024/y')?.location).toBe('/b')
    expect(matchRedirect(rules, '/blog/z')).toEqual({
      location: '/a',
      permanent: false,
    })
    expect(matchRedirect(rules, '/outra')).toBeNull()
  })
})

describe('createsRedirectLoop', () => {
  it('detects self and chained loops', () => {
    expect(createsRedirectLoop([], rule('/a', '/a#x'))).toBe(true)
    expect(createsRedirectLoop([rule('/b', '/a')], rule('/a', '/b'))).toBe(true)
    expect(
      createsRedirectLoop(
        [rule('/b', '/c'), rule('/c', '/a')],
        rule('/a', '/b'),
      ),
    ).toBe(true)
  })

  it('detects prefix rules that grow forever', () => {
    expect(createsRedirectLoop([], rule('/blog/*', '/blog/novo/*'))).toBe(true)
  })

  it('accepts chains that end, external targets and replacements', () => {
    expect(createsRedirectLoop([rule('/b', '/c')], rule('/a', '/b'))).toBe(
      false,
    )
    expect(createsRedirectLoop([], rule('/a', 'https://x.com/a'))).toBe(false)
    expect(createsRedirectLoop([rule('/a', '/a2')], rule('/a', '/b'))).toBe(
      false,
    )
    expect(createsRedirectLoop([], rule('/blog/*', '/novidades/*'))).toBe(false)
  })
})
