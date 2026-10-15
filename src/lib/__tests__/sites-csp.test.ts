import { describe, expect, it } from 'vitest'
import { hasTrackers, siteHeaderCsp, siteMetaCsp } from '@/src/lib/sites/csp'

describe('site CSP', () => {
  it('knows when a site has trackers', () => {
    expect(hasTrackers(undefined)).toBe(false)
    expect(hasTrackers({})).toBe(false)
    expect(hasTrackers({ metaPixelId: '123456' })).toBe(true)
  })

  it('allows every supported tracker in the header policy', () => {
    const csp = siteHeaderCsp({ nonce: 'abc' })
    expect(csp).toContain(
      "script-src 'self' 'nonce-abc' https://www.googletagmanager.com https://connect.facebook.net;",
    )
    expect(csp).toContain('https://*.google-analytics.com')
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp).toContain('upgrade-insecure-requests')
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain('axiom')
    expect(siteHeaderCsp({ nonce: 'abc', development: true })).toContain(
      "'unsafe-eval'",
    )
  })

  it('keeps only the configured trackers in the per-site policy', () => {
    const none = siteMetaCsp(undefined, { nonce: 'n' })
    expect(none).toContain("script-src 'self' 'nonce-n';")
    expect(none).toContain("connect-src 'self';")
    expect(none).not.toContain('frame-ancestors')

    const ga = siteMetaCsp({ googleAnalyticsId: 'G-ABC123' }, {})
    expect(ga).toContain("script-src 'self' https://www.googletagmanager.com;")
    expect(ga).not.toContain('facebook')

    const all = siteMetaCsp(
      {
        googleTagManagerId: 'GTM-ABC123',
        googleAnalyticsId: 'G-ABC123',
        metaPixelId: '123456',
      },
      { nonce: 'n' },
    )
    // Origins are listed once even when two trackers share them.
    expect(all.match(/https:\/\/www\.googletagmanager\.com/g)).toHaveLength(2)
    expect(all).toContain('https://connect.facebook.net')
    expect(all).toContain('https://www.facebook.com')
  })
})
