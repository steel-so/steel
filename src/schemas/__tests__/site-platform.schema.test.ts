import { describe, expect, it } from 'vitest'
import {
  isValidSiteTimeZone,
  parseSiteSettings,
  SiteAbsoluteUrlSchema,
  SiteSettingsSchema,
} from '../site.schema'
import {
  daysInRange,
  SiteAnalyticsDaySchema,
  SiteAnalyticsQuerySchema,
  SiteAnalyticsSummaryQuerySchema,
} from '../site-analytics.schema'
import { parseSitePageSeo, SitePageSeoSchema } from '../site-page.schema'
import {
  CreateSiteRedirectSchema,
  UpdateSiteRedirectSchema,
} from '../site-redirect.schema'
import { RecordSiteViewSchema } from '../site-view.schema'

describe('site platform schemas (S2)', () => {
  it('validates settings: timezone and JSON-LD organization', () => {
    expect(isValidSiteTimeZone('America/Manaus')).toBe(true)
    expect(isValidSiteTimeZone('Mars/Olympus')).toBe(false)
    const parsed = SiteSettingsSchema.parse({
      timezone: 'America/Manaus',
      seo: {
        organizationName: 'Clínica',
        logoUrl: '/media/logo.png',
        sameAs: ['https://instagram.com/clinica'],
      },
    })
    expect(parsed.timezone).toBe('America/Manaus')
    expect(parsed.seo.sameAs).toEqual(['https://instagram.com/clinica'])
    expect(SiteSettingsSchema.safeParse({ timezone: 'x/y' }).success).toBe(
      false,
    )
    expect(
      SiteSettingsSchema.safeParse({ seo: { sameAs: ['/instagram'] } }).success,
    ).toBe(false)
    expect(parseSiteSettings({ timezone: 'nope' }).timezone).toBeUndefined()
    expect(SiteAbsoluteUrlSchema.safeParse('https://x.com').success).toBe(true)
    expect(SiteAbsoluteUrlSchema.safeParse('ftp://x.com').success).toBe(false)
  })

  it('validates page SEO: canonical, sitemap priority and frequency', () => {
    const seo = SitePageSeoSchema.parse({
      canonicalUrl: 'https://outro.com/pagina',
      sitemapPriority: 0.5,
      changeFrequency: 'monthly',
    })
    expect(seo.changeFrequency).toBe('monthly')
    expect(SitePageSeoSchema.safeParse({ sitemapPriority: 2 }).success).toBe(
      false,
    )
    expect(
      SitePageSeoSchema.safeParse({ changeFrequency: 'sometimes' }).success,
    ).toBe(false)
    expect(
      SitePageSeoSchema.safeParse({ canonicalUrl: '/relativo' }).success,
    ).toBe(false)
    expect(parseSitePageSeo({ sitemapPriority: 9 })).toEqual({})
  })

  it('accepts conversions in the view beacon', () => {
    expect(RecordSiteViewSchema.parse({ path: '/' }).kind).toBe('VIEW')
    expect(
      RecordSiteViewSchema.parse({
        path: '/',
        kind: 'CONVERSION',
        formToken: 'tok',
      }),
    ).toMatchObject({ kind: 'CONVERSION', formToken: 'tok' })
    expect(
      RecordSiteViewSchema.safeParse({ path: '/', kind: 'CLICK' }).success,
    ).toBe(false)
  })

  it('normalizes redirect sources and checks targets', () => {
    expect(
      CreateSiteRedirectSchema.parse({ fromPath: '/Antigo/', toPath: '/novo' }),
    ).toEqual({ fromPath: '/antigo', toPath: '/novo', permanent: true })
    const invalid = CreateSiteRedirectSchema.safeParse({
      fromPath: 'antigo',
      toPath: 'javascript:alert(1)',
    })
    expect(invalid.success).toBe(false)
    expect(invalid.error?.issues.map((issue) => issue.path[0])).toEqual([
      'fromPath',
      'toPath',
    ])
    expect(
      CreateSiteRedirectSchema.safeParse({ fromPath: '', toPath: '' }).success,
    ).toBe(false)
    expect(UpdateSiteRedirectSchema.safeParse({}).success).toBe(false)
    expect(UpdateSiteRedirectSchema.parse({ permanent: false })).toEqual({
      permanent: false,
    })
  })

  it('validates metric ranges', () => {
    expect(SiteAnalyticsDaySchema.safeParse('2026-02-30').success).toBe(false)
    expect(SiteAnalyticsDaySchema.safeParse('2026-2-3').success).toBe(false)
    expect(SiteAnalyticsDaySchema.safeParse('2026-02-28').success).toBe(true)
    expect(daysInRange('2026-10-01', '2026-10-01')).toBe(1)
    expect(SiteAnalyticsQuerySchema.parse({})).toEqual({})
    expect(
      SiteAnalyticsQuerySchema.safeParse({
        from: '2026-10-10',
        to: '2026-10-01',
      }).success,
    ).toBe(false)
    expect(
      SiteAnalyticsQuerySchema.safeParse({
        from: '2024-01-01',
        to: '2026-01-01',
      }).success,
    ).toBe(false)
    expect(
      SiteAnalyticsQuerySchema.safeParse({ from: '2026-10-01' }).success,
    ).toBe(true)
    expect(SiteAnalyticsSummaryQuerySchema.parse({}).days).toBe(14)
    expect(SiteAnalyticsSummaryQuerySchema.parse({ days: '30' }).days).toBe(30)
    expect(SiteAnalyticsSummaryQuerySchema.safeParse({ days: 3 }).success).toBe(
      false,
    )
  })
})
