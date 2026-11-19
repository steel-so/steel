import type { Prisma, Role, SiteSeoKeyword } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSite,
  createFakeSitePage,
  createFakeSnapshot,
} from '@/src/__tests__/factories/site.factory'
import {
  searchDocument,
  searchSettings,
} from '@/src/__tests__/factories/site-search.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { heading, text } from '@/src/lib/canvas-site/presets/builder'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SITE_SEARCH_SETTINGS } from '@/src/schemas/site-search.schema'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/site-page.repository')
vi.mock('@/src/repositories/site-global.repository')
vi.mock('@/src/repositories/site-seo.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../site-indexnow.service', () => ({
  SiteIndexNowService: { ping: vi.fn() },
}))

import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import { SiteSeoRepository } from '@/src/repositories/site-seo.repository'
import { MAX_SEO_KEYWORDS_PER_SITE } from '@/src/schemas/site-seo.schema'
import { SiteIndexNowService } from '../site-indexnow.service'
import { SiteSeoService } from '../site-seo.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const pages = vi.mocked(SitePageRepository)
const globals = vi.mocked(SiteGlobalRepository)
const seo = vi.mocked(SiteSeoRepository)
const ping = vi.mocked(SiteIndexNowService.ping)

const WS = 'ws1'
const SITE = 'site1'
const NOW = new Date('2026-11-19T12:00:00Z')
const json = (value: unknown) => value as Prisma.JsonValue

function site(status: 'DRAFT' | 'PUBLISHED' = 'DRAFT', settings: unknown = {}) {
  return createFakeSite({
    id: SITE,
    workspaceId: WS,
    slug: 'sorriso',
    name: 'Sorriso',
    status,
    settings: json(settings),
    homePageId: 'home',
  })
}

function asRole(role: Role) {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const home = createFakeSitePage({
  id: 'home',
  siteId: SITE,
  title: 'Clareamento dental',
  slug: 'inicio',
  path: 'inicio',
  isHome: true,
  document: json(
    searchDocument(
      heading('h1', 'Clareamento dental'),
      text('<p>O clareamento dental é seguro.</p>'),
    ),
  ),
  seo: json({ title: 'Clareamento dental', description: 'Clareamento.' }),
})
const empty = createFakeSitePage({
  id: 'about',
  siteId: SITE,
  title: 'Sobre',
  slug: 'sobre',
  path: 'sobre',
  document: json(searchDocument(text('<p>Olá.</p>'))),
})

function keyword(id: string, term: string): SiteSeoKeyword {
  return {
    id,
    siteId: SITE,
    term,
    normalized: term.toLowerCase(),
    createdById: 'u1',
    createdAt: NOW,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  asRole('MEMBER')
  sites.findById.mockResolvedValue(ok(site()))
  sites.listByWorkspace.mockResolvedValue(
    ok([{ ...site(), _count: { pages: 2 } }]),
  )
  pages.listWithDocuments.mockResolvedValue(ok([home, empty]))
  globals.listBySite.mockResolvedValue(ok([]))
  seo.listSnapshots.mockResolvedValue(ok([]))
  seo.listKeywords.mockResolvedValue(ok([]))
  seo.countKeywords.mockResolvedValue(ok(0))
  seo.upsertSnapshot.mockResolvedValue(ok(undefined))
})

describe('SiteSeoService authorization', () => {
  it('blocks non-members and lets viewers read but not write', async () => {
    membership.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(await SiteSeoService.overview('u1', WS, NOW), 'FORBIDDEN')

    asRole('VIEWER')
    expectOk(await SiteSeoService.overview('u1', WS, NOW))
    expectOk(await SiteSeoService.detail('u1', WS, SITE, NOW))
    expectErr(
      await SiteSeoService.addKeyword('u1', WS, SITE, { term: 'dentista' }),
      'FORBIDDEN',
    )
    expectErr(
      await SiteSeoService.removeKeyword('u1', WS, SITE, 'k1'),
      'FORBIDDEN',
    )
    expectErr(await SiteSeoService.reindex('u1', WS, SITE), 'FORBIDDEN')
  })
})

describe('SiteSeoService.overview', () => {
  it('returns an empty list for a workspace without sites', async () => {
    sites.listByWorkspace.mockResolvedValueOnce(ok([]))
    const result = expectOk(await SiteSeoService.overview('u1', WS, NOW))
    expect(result.sites).toEqual([])
  })

  it('scores each site, saves today and builds the history', async () => {
    seo.listSnapshots.mockResolvedValueOnce(
      ok([
        {
          id: 's0',
          siteId: SITE,
          day: new Date('2026-11-01T00:00:00Z'),
          seo: 10,
          aeo: 10,
          geo: 10,
          pages: 2,
          issues: 30,
          createdAt: NOW,
        },
      ]),
    )
    seo.countKeywords.mockResolvedValueOnce(ok(3))
    const { sites: cards } = expectOk(
      await SiteSeoService.overview('u1', WS, NOW),
    )
    expect(cards).toHaveLength(1)
    const card = cards[0]
    expect(card).toMatchObject({
      id: SITE,
      pageCount: 2,
      hasData: true,
      keywordCount: 3,
      status: 'DRAFT',
    })
    expect(card.overall).toBe(
      Math.round(
        (card.averages.seo + card.averages.aeo + card.averages.geo) / 3,
      ),
    )
    expect(card.worstPages.length).toBeGreaterThan(0)
    expect(card.worstPages[0].id).toBe('about')
    expect(card.history.map((point) => point.day)).toEqual([
      '2026-11-01',
      '2026-11-19',
    ])
    expect(card.delta).toBe(card.overall - 10)
    expect(card.indexNow).toEqual({ enabled: false, canPing: false })
    expect(seo.upsertSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: SITE,
        day: new Date('2026-11-19T00:00:00Z'),
        pages: 2,
      }),
    )
  })

  it('does not save a second snapshot when today already has one', async () => {
    seo.listSnapshots.mockResolvedValueOnce(
      ok([
        {
          id: 's1',
          siteId: SITE,
          day: new Date('2026-11-19T00:00:00Z'),
          seo: 50,
          aeo: 50,
          geo: 50,
          pages: 2,
          issues: 4,
          createdAt: NOW,
        },
      ]),
    )
    const { sites: cards } = expectOk(
      await SiteSeoService.overview('u1', WS, NOW),
    )
    expect(seo.upsertSnapshot).not.toHaveBeenCalled()
    expect(cards[0].history).toHaveLength(1)
    expect(cards[0].delta).toBeNull()
  })

  it('shows a site without pages as having no data and saves nothing', async () => {
    pages.listWithDocuments.mockResolvedValueOnce(ok([]))
    const { sites: cards } = expectOk(
      await SiteSeoService.overview('u1', WS, NOW),
    )
    expect(cards[0]).toMatchObject({ hasData: false, pageCount: 0, overall: 0 })
    expect(seo.upsertSnapshot).not.toHaveBeenCalled()
  })

  it('flags IndexNow readiness of a published site', async () => {
    const settings = searchSettings({
      search: {
        ...DEFAULT_SITE_SEARCH_SETTINGS,
        indexNow: { enabled: true, key: 'abcdef12' },
      },
    })
    sites.listByWorkspace.mockResolvedValueOnce(
      ok([{ ...site('PUBLISHED', settings), _count: { pages: 2 } }]),
    )
    const { sites: cards } = expectOk(
      await SiteSeoService.overview('u1', WS, NOW),
    )
    expect(cards[0].indexNow).toEqual({ enabled: true, canPing: true })
  })

  it('propagates repository failures', async () => {
    sites.listByWorkspace.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await SiteSeoService.overview('u1', WS, NOW), 'DATABASE_ERROR')

    pages.listWithDocuments.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await SiteSeoService.overview('u1', WS, NOW), 'DATABASE_ERROR')

    seo.listSnapshots.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await SiteSeoService.overview('u1', WS, NOW), 'DATABASE_ERROR')
  })
})

describe('SiteSeoService.detail', () => {
  it('returns the checklist, the issues and the analyzed keywords', async () => {
    seo.listKeywords.mockResolvedValueOnce(
      ok([keyword('k1', 'clareamento dental'), keyword('k2', 'implante')]),
    )
    const detail = expectOk(await SiteSeoService.detail('u1', WS, SITE, NOW))
    expect(detail.card.keywordCount).toBe(2)
    expect(detail.pages).toHaveLength(2)
    expect(detail.pages[0].id).toBe('about')
    expect(detail.issues.length).toBeGreaterThan(0)
    expect(detail.technical.map((item) => item.id)).toContain('links.broken')
    const [used, missing] = detail.keywords
    expect(used.status).not.toBe('missing')
    expect(used.pages[0]).toMatchObject({ id: 'home', inTitle: true })
    expect(missing.status).toBe('missing')
    expect(detail.history.at(-1)?.day).toBe('2026-11-19')
  })

  it('fails for another workspace and on repository errors', async () => {
    sites.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteSeoService.detail('u1', 'other', SITE, NOW),
      'DATABASE_ERROR',
    )
    seo.listKeywords.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteSeoService.detail('u1', WS, SITE, NOW),
      'DATABASE_ERROR',
    )
    seo.listSnapshots.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteSeoService.detail('u1', WS, SITE, NOW),
      'DATABASE_ERROR',
    )
  })
})

describe('SiteSeoService keywords', () => {
  it('creates a cleaned keyword with its normalized form', async () => {
    seo.createKeyword.mockImplementation(async (data) =>
      ok({ ...keyword('k1', data.term), normalized: data.normalized }),
    )
    const created = expectOk(
      await SiteSeoService.addKeyword('u1', WS, SITE, {
        term: '  Clínica   Odontológica ',
      }),
    )
    expect(created).toEqual({ id: 'k1', term: 'Clínica Odontológica' })
    expect(seo.createKeyword).toHaveBeenCalledWith({
      siteId: SITE,
      term: 'Clínica Odontológica',
      normalized: 'clinica odontologica',
      createdById: 'u1',
    })
  })

  it('enforces the per-site limit and surfaces duplicates', async () => {
    seo.countKeywords.mockResolvedValueOnce(ok(MAX_SEO_KEYWORDS_PER_SITE))
    expectErr(
      await SiteSeoService.addKeyword('u1', WS, SITE, { term: 'dentista' }),
      'SEO_KEYWORD_LIMIT_REACHED',
    )
    expect(seo.createKeyword).not.toHaveBeenCalled()

    seo.createKeyword.mockResolvedValueOnce(
      err({
        code: 'SEO_KEYWORD_DUPLICATE',
        message: 'dup',
      } as never),
    )
    expectErr(
      await SiteSeoService.addKeyword('u1', WS, SITE, { term: 'dentista' }),
      'SEO_KEYWORD_DUPLICATE',
    )
  })

  it('removes a keyword of the site', async () => {
    seo.deleteKeyword.mockResolvedValueOnce(ok(undefined))
    expectOk(await SiteSeoService.removeKeyword('u1', WS, SITE, 'k1'))
    expect(seo.deleteKeyword).toHaveBeenCalledWith('k1', SITE)

    seo.deleteKeyword.mockResolvedValueOnce(
      err({ code: 'SEO_KEYWORD_NOT_FOUND', message: 'x' } as never),
    )
    expectErr(
      await SiteSeoService.removeKeyword('u1', WS, SITE, 'nope'),
      'SEO_KEYWORD_NOT_FOUND',
    )
  })
})

describe('SiteSeoService.reindex', () => {
  const published = (
    indexNow: { enabled: boolean; key?: string },
    noindex = false,
  ) => {
    const snapshot = createFakeSnapshot({
      settings: searchSettings({
        seo: { noindex },
        search: { ...DEFAULT_SITE_SEARCH_SETTINGS, indexNow },
      }),
    })
    sites.findById.mockResolvedValue(ok(site('PUBLISHED')))
    sites.findPublishedBySlug.mockResolvedValue(
      ok({
        ...site('PUBLISHED'),
        publishedVersion: {
          id: 'v1',
          snapshot: json(snapshot),
          createdAt: NOW,
        },
      }),
    )
    return snapshot
  }

  it('refuses a site that was never published', async () => {
    expectErr(await SiteSeoService.reindex('u1', WS, SITE), 'SEO_NOT_PUBLISHED')
    expect(ping).not.toHaveBeenCalled()
  })

  it('refuses when IndexNow is off, keyless or the site is hidden', async () => {
    published({ enabled: false, key: 'abcdef12' })
    expectErr(await SiteSeoService.reindex('u1', WS, SITE), 'SEO_INDEXNOW_OFF')
    published({ enabled: true })
    expectErr(await SiteSeoService.reindex('u1', WS, SITE), 'SEO_INDEXNOW_OFF')
    published({ enabled: true, key: 'abcdef12' }, true)
    expectErr(await SiteSeoService.reindex('u1', WS, SITE), 'SEO_INDEXNOW_OFF')
    expect(ping).not.toHaveBeenCalled()
  })

  it('pings the engines with the published snapshot', async () => {
    published({ enabled: true, key: 'abcdef12' })
    ping.mockResolvedValueOnce(ok({ sent: 4, status: 202 }))
    expect(expectOk(await SiteSeoService.reindex('u1', WS, SITE))).toEqual({
      sent: 4,
      status: 202,
    })
    expect(ping).toHaveBeenCalledWith(
      'sorriso',
      expect.objectContaining({ name: 'Clínica' }),
    )
  })

  it('reports an unreadable published version', async () => {
    published({ enabled: true, key: 'abcdef12' })
    sites.findPublishedBySlug.mockResolvedValue(
      ok({
        ...site('PUBLISHED'),
        publishedVersion: { id: 'v1', snapshot: json({}), createdAt: NOW },
      }),
    )
    expectErr(await SiteSeoService.reindex('u1', WS, SITE), 'SEO_NOT_PUBLISHED')
  })
})

describe('SiteSeoService.recordDailySnapshots', () => {
  it('snapshots every site, counts failures and prunes old rows', async () => {
    seo.listSiteIdsForSnapshot.mockResolvedValue(
      ok([
        { id: SITE, workspaceId: WS },
        { id: 'gone', workspaceId: WS },
      ]),
    )
    sites.findById.mockImplementation(async (id) =>
      id === SITE ? ok(site()) : err(databaseError('x')),
    )
    seo.pruneSnapshots.mockResolvedValue(ok(7))
    const result = expectOk(await SiteSeoService.recordDailySnapshots(NOW))
    expect(result).toEqual({ sites: 2, failed: 1, pruned: 7 })
    expect(seo.upsertSnapshot).toHaveBeenCalledTimes(1)
    const [cutoff] = seo.pruneSnapshots.mock.calls[0]
    expect(cutoff.toISOString()).toBe('2025-10-15T00:00:00.000Z')
  })

  it('counts a site whose pages cannot be read as failed', async () => {
    seo.listSiteIdsForSnapshot.mockResolvedValue(
      ok([{ id: SITE, workspaceId: WS }]),
    )
    pages.listWithDocuments.mockResolvedValueOnce(err(databaseError('x')))
    seo.pruneSnapshots.mockResolvedValue(err(databaseError('x')))
    expect(expectOk(await SiteSeoService.recordDailySnapshots(NOW))).toEqual({
      sites: 1,
      failed: 1,
      pruned: 0,
    })
  })

  it('fails when the site list cannot be read', async () => {
    seo.listSiteIdsForSnapshot.mockResolvedValue(err(databaseError('x')))
    expectErr(await SiteSeoService.recordDailySnapshots(NOW), 'DATABASE_ERROR')
  })
})
