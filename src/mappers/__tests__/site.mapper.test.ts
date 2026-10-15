import { describe, expect, it } from 'vitest'
import {
  createFakeSite,
  createFakeSiteGlobal,
  createFakeSitePage,
} from '@/src/__tests__/factories/site.factory'
import {
  toSiteDTO,
  toSiteGlobalDTO,
  toSitePageDTO,
  toSitePageSummaryDTO,
  toSiteSummaryDTO,
  toSiteVersionDTO,
} from '../site.mapper'

describe('site mappers', () => {
  it('maps a site with parsed settings and the public URL', () => {
    const publishedAt = new Date('2026-10-14T12:00:00Z')
    const site = createFakeSite({
      theme: { palette: { primary: '#000' } },
      settings: { cookieBanner: { enabled: true } },
      publishedAt,
    })
    const dto = toSiteDTO(site, 'https://x/s/a')
    expect(dto.url).toBe('https://x/s/a')
    expect(dto.theme).toEqual({ palette: { primary: '#000' } })
    expect(dto.settings.cookieBanner).toEqual({ enabled: true })
    expect(dto.publishedAt).toBe(publishedAt.toISOString())
    expect(dto).not.toHaveProperty('deletedAt')
  })

  it('falls back to defaults for malformed JSON columns', () => {
    const dto = toSiteDTO(
      createFakeSite({ theme: [1, 2], settings: { tracking: 'x' } }),
      'u',
    )
    expect(dto.theme).toEqual({})
    expect(dto.settings.tracking).toEqual({})
    expect(dto.publishedAt).toBeNull()
    expect(toSiteDTO(createFakeSite({ theme: null }), 'u').theme).toEqual({})
  })

  it('maps the list row', () => {
    const site = createFakeSite({ publishedAt: new Date() })
    const row = toSiteSummaryDTO({ ...site, _count: { pages: 3 } }, 'u')
    expect(row).toMatchObject({ id: site.id, pageCount: 3, url: 'u' })
    expect(row.publishedAt).not.toBeNull()
    expect(
      toSiteSummaryDTO({ ...createFakeSite(), _count: { pages: 0 } }, 'u')
        .publishedAt,
    ).toBeNull()
  })

  it('maps pages with and without the document', () => {
    const page = createFakeSitePage({ seo: { title: 'SEO', bogus: 1 } })
    const summary = toSitePageSummaryDTO(page)
    expect(summary.seo).toEqual({ title: 'SEO' })
    expect(summary).not.toHaveProperty('document')
    const full = toSitePageDTO(page)
    expect(full.document).toEqual(page.document)
    expect(full.createdAt).toBe(page.createdAt.toISOString())
    expect(toSitePageSummaryDTO(createFakeSitePage({ seo: 'x' })).seo).toEqual(
      {},
    )
  })

  it('maps globals and versions', () => {
    const global = createFakeSiteGlobal({ kind: 'FOOTER' })
    expect(toSiteGlobalDTO(global)).toMatchObject({
      id: global.id,
      kind: 'FOOTER',
    })
    const version = {
      id: 'v1',
      siteId: 's1',
      number: 2,
      publishedById: 'u1',
      createdAt: new Date('2026-10-14T00:00:00Z'),
      publishedBy: { name: 'Ana' },
    }
    expect(toSiteVersionDTO(version, 'v1')).toEqual({
      id: 'v1',
      siteId: 's1',
      number: 2,
      publishedById: 'u1',
      publishedByName: 'Ana',
      isLive: true,
      createdAt: '2026-10-14T00:00:00.000Z',
    })
    expect(
      toSiteVersionDTO({ ...version, publishedBy: null }, null),
    ).toMatchObject({ publishedByName: null, isLive: false })
  })
})
