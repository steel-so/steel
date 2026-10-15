import { describe, expect, it } from 'vitest'
import {
  CreateSiteSchema,
  DEFAULT_SITE_SETTINGS,
  parseSiteSettings,
  SiteSettingsSchema,
  SiteSlugSchema,
  SiteThemeSchema,
  SiteUrlSchema,
  UpdateSiteSchema,
} from '../site.schema'
import {
  CreateSiteGlobalSchema,
  UpdateSiteGlobalSchema,
} from '../site-global.schema'
import {
  CreateSitePageSchema,
  DuplicateSitePageSchema,
  parseSitePageSeo,
  ReorderSitePagesSchema,
  UpdateSitePageSchema,
} from '../site-page.schema'
import { RecordSiteViewSchema } from '../site-view.schema'

describe('site schemas', () => {
  it('accepts http(s) URLs and same-origin paths only', () => {
    expect(SiteUrlSchema.safeParse('https://x.com/a.png').success).toBe(true)
    expect(SiteUrlSchema.safeParse('/media/a.png').success).toBe(true)
    expect(SiteUrlSchema.safeParse('//evil.com/a').success).toBe(false)
    expect(SiteUrlSchema.safeParse('javascript:alert(1)').success).toBe(false)
    expect(SiteUrlSchema.safeParse('data:image/png;base64,x').success).toBe(
      false,
    )
  })

  it('normalizes and validates slugs', () => {
    expect(SiteSlugSchema.parse(' Clinica ')).toBe('clinica')
    expect(SiteSlugSchema.safeParse('www').success).toBe(false)
    expect(SiteSlugSchema.safeParse('a b').success).toBe(false)
  })

  it('caps the theme size', () => {
    expect(SiteThemeSchema.safeParse({ a: 1 }).success).toBe(true)
    expect(SiteThemeSchema.safeParse({ a: 'x'.repeat(70_000) }).success).toBe(
      false,
    )
  })

  it('fills settings defaults and validates tracking ids', () => {
    expect(DEFAULT_SITE_SETTINGS).toEqual({
      seo: {},
      tracking: {},
      cookieBanner: { enabled: false },
    })
    expect(
      SiteSettingsSchema.safeParse({
        tracking: {
          googleAnalyticsId: 'G-ABC1234',
          googleTagManagerId: 'GTM-ABCD12',
          metaPixelId: '1234567890',
        },
        cookieBanner: { enabled: true, policyUrl: '/privacidade' },
      }).success,
    ).toBe(true)
    expect(
      SiteSettingsSchema.safeParse({ tracking: { googleAnalyticsId: 'UA-1' } })
        .success,
    ).toBe(false)
    expect(parseSiteSettings(null)).toEqual(DEFAULT_SITE_SETTINGS)
    expect(parseSiteSettings({ faviconUrl: 'javascript:x' })).toEqual(
      DEFAULT_SITE_SETTINGS,
    )
  })

  it('validates site create/update payloads', () => {
    expect(CreateSiteSchema.safeParse({ name: 'Clínica' }).success).toBe(true)
    expect(CreateSiteSchema.safeParse({ name: '' }).success).toBe(false)
    expect(UpdateSiteSchema.safeParse({}).success).toBe(false)
    expect(UpdateSiteSchema.safeParse({ homePageId: 'p1' }).success).toBe(true)
  })

  it('validates page payloads', () => {
    expect(
      CreateSitePageSchema.safeParse({ title: 'Contato', slug: 'Contato' }).data
        ?.slug,
    ).toBe('contato')
    expect(
      CreateSitePageSchema.safeParse({ title: 'x', slug: 'a b' }).success,
    ).toBe(false)
    expect(UpdateSitePageSchema.safeParse({}).success).toBe(false)
    expect(
      UpdateSitePageSchema.safeParse({ document: { catalog: 'site' } }).success,
    ).toBe(false)
    expect(
      UpdateSitePageSchema.safeParse({
        document: { catalog: 'site', version: 1, rootId: 'root', nodes: {} },
      }).success,
    ).toBe(true)
    expect(UpdateSitePageSchema.safeParse({ parentId: null }).success).toBe(
      true,
    )
    expect(ReorderSitePagesSchema.safeParse({ orderedIds: [] }).success).toBe(
      false,
    )
    expect(DuplicateSitePageSchema.parse({})).toEqual({})
    expect(parseSitePageSeo({ noindex: true })).toEqual({ noindex: true })
    expect(parseSitePageSeo({ socialImageUrl: 'ftp://x' })).toEqual({})
    expect(parseSitePageSeo(undefined)).toEqual({})
  })

  it('validates global and view payloads', () => {
    expect(
      CreateSiteGlobalSchema.safeParse({ kind: 'HEADER', name: 'Topo' })
        .success,
    ).toBe(true)
    expect(
      CreateSiteGlobalSchema.safeParse({ kind: 'MENU', name: 'x' }).success,
    ).toBe(false)
    expect(UpdateSiteGlobalSchema.safeParse({}).success).toBe(false)
    expect(RecordSiteViewSchema.parse({})).toEqual({ path: '', kind: 'VIEW' })
    expect(
      RecordSiteViewSchema.safeParse({ utmSource: 'x'.repeat(121) }).success,
    ).toBe(false)
  })
})
