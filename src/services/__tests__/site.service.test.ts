import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSite,
  createFakeSiteGlobal,
  createFakeSitePage,
  createFakeSiteVersion,
  createSiteDocument,
} from '@/src/__tests__/factories/site.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/site-page.repository')
vi.mock('@/src/repositories/site-global.repository')
vi.mock('@/src/lib/sites/cache')
vi.mock('@/lib/axiom/audit')

import { auditMutation } from '@/lib/axiom/audit'
import { revalidateSites } from '@/src/lib/sites/cache'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  findFreeSiteSlug,
  MAX_SITES_PER_WORKSPACE,
  SiteService,
} from '../site.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const pages = vi.mocked(SitePageRepository)
const globals = vi.mocked(SiteGlobalRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const audit = vi.mocked(auditMutation)
const revalidate = vi.mocked(revalidateSites)

const WS = 'ws1'
const site = createFakeSite({ id: 'site1', workspaceId: WS, slug: 'clinica' })

function asRole(role: Role) {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  asRole('OWNER')
  sites.findById.mockResolvedValue(ok(site))
})

describe('SiteService authorization', () => {
  it('blocks non-members, a disabled module and missing permissions', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await SiteService.list('u1', WS), 'FORBIDDEN')

    asRole('OWNER')
    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(await SiteService.list('u1', WS), 'MODULE_DISABLED')

    asRole('VIEWER')
    expectErr(await SiteService.create('u1', WS, { name: 'x' }), 'FORBIDDEN')
    expectErr(
      await SiteService.update('u1', WS, site.id, { name: 'x' }),
      'FORBIDDEN',
    )
    expectErr(await SiteService.publish('u1', WS, site.id), 'FORBIDDEN')

    asRole('MEMBER')
    expectErr(await SiteService.remove('u1', WS, site.id), 'FORBIDDEN')
    expect(sites.softDelete).not.toHaveBeenCalled()
  })

  it('scopes the site to the workspace', async () => {
    sites.findById.mockResolvedValue(
      err(appError('SITE_NOT_FOUND', 'Site não encontrado')),
    )
    expectErr(await SiteService.get('u1', 'other', site.id), 'SITE_NOT_FOUND')
    expect(sites.findById).toHaveBeenCalledWith(site.id, 'other')
  })
})

describe('SiteService reads', () => {
  it('lists and gets sites with their public URL', async () => {
    sites.listByWorkspace.mockResolvedValue(
      ok([{ ...site, _count: { pages: 2 } }]),
    )
    const list = expectOk(await SiteService.list('u1', WS))
    expect(list[0]).toMatchObject({ slug: 'clinica', pageCount: 2 })
    expect(list[0].url).toMatch(/\/s\/clinica$/)

    expect(expectOk(await SiteService.get('u1', WS, site.id)).id).toBe(site.id)

    sites.listByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await SiteService.list('u1', WS), 'DATABASE_ERROR')
  })

  it('checks slug availability', async () => {
    sites.isSlugTaken.mockResolvedValue(ok(true))
    expect(
      expectOk(await SiteService.checkSlug('u1', WS, 'clinica', site.id)),
    ).toEqual({ slug: 'clinica', available: false })
    expect(sites.isSlugTaken).toHaveBeenCalledWith('clinica', site.id)

    sites.isSlugTaken.mockResolvedValue(err(databaseError()))
    expectErr(await SiteService.checkSlug('u1', WS, 'x'), 'DATABASE_ERROR')

    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await SiteService.checkSlug('u1', WS, 'x'), 'FORBIDDEN')
  })
})

describe('findFreeSiteSlug', () => {
  it('takes the first free suffix', async () => {
    sites.isSlugTaken
      .mockResolvedValueOnce(ok(true))
      .mockResolvedValueOnce(ok(false))
    expect(expectOk(await findFreeSiteSlug('clinica'))).toBe('clinica-2')
  })

  it('falls back to a random suffix and propagates errors', async () => {
    sites.isSlugTaken.mockResolvedValue(ok(true))
    expect(expectOk(await findFreeSiteSlug('clinica'))).toMatch(/^clinica-\d+$/)
    sites.isSlugTaken.mockResolvedValue(err(databaseError()))
    expectErr(await findFreeSiteSlug('clinica'), 'DATABASE_ERROR')
  })
})

describe('SiteService.create', () => {
  beforeEach(() => {
    sites.countByWorkspace.mockResolvedValue(ok(0))
    sites.isSlugTaken.mockResolvedValue(ok(false))
    sites.createWithPages.mockResolvedValue(ok(site))
  })

  it('creates a site with a blank home page and a derived slug', async () => {
    const dto = expectOk(
      await SiteService.create('u1', WS, { name: 'Clínica São Lucas' }),
    )
    expect(dto.id).toBe(site.id)
    const input = sites.createWithPages.mock.calls[0][0]
    expect(input.site).toMatchObject({
      slug: 'clinica-sao-lucas',
      workspaceId: WS,
      createdById: 'u1',
      theme: {},
    })
    expect(input.pages).toHaveLength(1)
    expect(input.pages[0]).toMatchObject({ isHome: true, path: 'inicio' })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'site', action: 'create' }),
    )
  })

  it('uses the given slug, theme and settings', async () => {
    await SiteService.create('u1', WS, {
      name: 'x',
      slug: 'meu-slug',
      theme: { a: 1 },
      settings: {
        seo: {},
        tracking: {},
        cookieBanner: { enabled: true },
      },
    })
    expect(sites.isSlugTaken).not.toHaveBeenCalled()
    expect(sites.createWithPages.mock.calls[0][0].site).toMatchObject({
      slug: 'meu-slug',
      theme: { a: 1 },
      settings: { cookieBanner: { enabled: true } },
    })
  })

  it('enforces the per-workspace limit', async () => {
    sites.countByWorkspace.mockResolvedValue(ok(MAX_SITES_PER_WORKSPACE))
    expectErr(
      await SiteService.create('u1', WS, { name: 'x' }),
      'SITE_LIMIT_REACHED',
    )
  })

  it('propagates count, slug and insert failures', async () => {
    sites.countByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteService.create('u1', WS, { name: 'x' }),
      'DATABASE_ERROR',
    )

    sites.isSlugTaken.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteService.create('u1', WS, { name: 'x' }),
      'DATABASE_ERROR',
    )

    sites.createWithPages.mockResolvedValueOnce(
      err(appError('SITE_SLUG_TAKEN', 'taken')),
    )
    expectErr(
      await SiteService.create('u1', WS, { name: 'x' }),
      'SITE_SLUG_TAKEN',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        reason: 'SITE_SLUG_TAKEN',
      }),
    )
  })
})

describe('SiteService.update', () => {
  beforeEach(() => {
    sites.update.mockResolvedValue(ok(site))
  })

  it('updates fields and moves the home page', async () => {
    pages.findById.mockResolvedValue(ok(createFakeSitePage({ id: 'p2' })))
    pages.setHome.mockResolvedValue(ok(undefined))
    expectOk(
      await SiteService.update('u1', WS, site.id, {
        name: 'Novo',
        theme: { a: 1 },
        settings: { seo: {}, tracking: {}, cookieBanner: { enabled: false } },
        homePageId: 'p2',
      }),
    )
    expect(pages.setHome).toHaveBeenCalledWith(site.id, 'p2')
    expect(sites.update).toHaveBeenCalledWith(site.id, {
      name: 'Novo',
      slug: undefined,
      theme: { a: 1 },
      settings: { seo: {}, tracking: {}, cookieBanner: { enabled: false } },
      updatedById: 'u1',
    })
    expect(revalidate).not.toHaveBeenCalled()
  })

  it('skips the home move when unchanged and expires both slugs on rename', async () => {
    const withHome = { ...site, homePageId: 'p1' }
    sites.findById.mockResolvedValue(ok(withHome))
    await SiteService.update('u1', WS, site.id, {
      homePageId: 'p1',
      slug: 'nova',
    })
    expect(pages.setHome).not.toHaveBeenCalled()
    expect(revalidate).toHaveBeenCalledWith('clinica', 'nova')

    revalidate.mockClear()
    await SiteService.update('u1', WS, site.id, { slug: 'clinica' })
    expect(revalidate).not.toHaveBeenCalled()
  })

  it('propagates page and update failures', async () => {
    pages.findById.mockResolvedValueOnce(
      err(appError('SITE_PAGE_NOT_FOUND', 'x')),
    )
    expectErr(
      await SiteService.update('u1', WS, site.id, { homePageId: 'zz' }),
      'SITE_PAGE_NOT_FOUND',
    )
    pages.findById.mockResolvedValue(ok(createFakeSitePage()))
    pages.setHome.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteService.update('u1', WS, site.id, { homePageId: 'p9' }),
      'DATABASE_ERROR',
    )
    sites.update.mockResolvedValueOnce(err(appError('SITE_SLUG_TAKEN', 'x')))
    expectErr(
      await SiteService.update('u1', WS, site.id, { slug: 'outro' }),
      'SITE_SLUG_TAKEN',
    )
  })
})

describe('SiteService.remove', () => {
  it('soft deletes and expires the cache', async () => {
    sites.softDelete.mockResolvedValue(ok(undefined))
    expectOk(await SiteService.remove('u1', WS, site.id))
    expect(sites.softDelete).toHaveBeenCalledWith(site.id, 'clinica')
    expect(revalidate).toHaveBeenCalledWith('clinica')

    sites.softDelete.mockResolvedValue(err(databaseError()))
    expectErr(await SiteService.remove('u1', WS, site.id), 'DATABASE_ERROR')
  })
})

describe('SiteService.publish', () => {
  const home = createFakeSitePage({
    id: 'home',
    siteId: site.id,
    isHome: true,
    document: createSiteDocument() as never,
  })
  const header = createFakeSiteGlobal({
    siteId: site.id,
    document: createSiteDocument() as never,
  })

  beforeEach(() => {
    pages.listWithDocuments.mockResolvedValue(ok([home]))
    globals.listBySite.mockResolvedValue(ok([header]))
  })

  it('snapshots the draft into a live version', async () => {
    const version = createFakeSiteVersion({ siteId: site.id, number: 4 })
    sites.publish.mockResolvedValue(
      ok({ site: { ...site, status: 'PUBLISHED' }, version }),
    )
    const result = expectOk(await SiteService.publish('u1', WS, site.id))
    expect(result.site.status).toBe('PUBLISHED')
    expect(result.version).toMatchObject({ number: 4, isLive: true })
    const snapshot = sites.publish.mock.calls[0][1] as {
      pages: unknown[]
      globals: unknown[]
    }
    expect(snapshot.pages).toHaveLength(1)
    expect(snapshot.globals).toHaveLength(1)
    expect(revalidate).toHaveBeenCalledWith('clinica')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'publish', meta: { version: 4 } }),
    )
  })

  it('refuses an empty site and invalid documents', async () => {
    pages.listWithDocuments.mockResolvedValueOnce(ok([]))
    expectErr(
      await SiteService.publish('u1', WS, site.id),
      'SITE_DOCUMENT_INVALID',
    )

    pages.listWithDocuments.mockResolvedValueOnce(
      ok([{ ...home, document: { catalog: 'email' } }]),
    )
    globals.listBySite.mockResolvedValueOnce(
      ok([{ ...header, document: null }]),
    )
    const error = expectErr(
      await SiteService.publish('u1', WS, site.id),
      'SITE_DOCUMENT_INVALID',
    )
    expect(error.details).toEqual([
      expect.objectContaining({ id: 'home' }),
      expect.objectContaining({ id: header.id }),
    ])
    expect(sites.publish).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'publish', outcome: 'failure' }),
    )
  })

  it('propagates read and publish failures', async () => {
    pages.listWithDocuments.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SiteService.publish('u1', WS, site.id), 'DATABASE_ERROR')
    globals.listBySite.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SiteService.publish('u1', WS, site.id), 'DATABASE_ERROR')
    sites.publish.mockResolvedValueOnce(err(appError('CONFLICT', 'x')))
    expectErr(await SiteService.publish('u1', WS, site.id), 'CONFLICT')
    expect(revalidate).not.toHaveBeenCalled()
    sites.findById.mockResolvedValueOnce(err(appError('SITE_NOT_FOUND', 'x')))
    expectErr(await SiteService.publish('u1', WS, site.id), 'SITE_NOT_FOUND')
  })
})

describe('SiteService.unpublish', () => {
  it('takes the site offline', async () => {
    sites.unpublish.mockResolvedValue(ok({ ...site, status: 'DRAFT' }))
    expect(
      expectOk(await SiteService.unpublish('u1', WS, site.id)).status,
    ).toBe('DRAFT')
    expect(revalidate).toHaveBeenCalledWith('clinica')
    sites.unpublish.mockResolvedValue(err(databaseError()))
    expectErr(await SiteService.unpublish('u1', WS, site.id), 'DATABASE_ERROR')
    sites.findById.mockResolvedValueOnce(err(appError('SITE_NOT_FOUND', 'x')))
    expectErr(await SiteService.unpublish('u1', WS, site.id), 'SITE_NOT_FOUND')
  })
})

describe('SiteService versions', () => {
  it('lists versions marking the live one', async () => {
    sites.findById.mockResolvedValue(ok({ ...site, publishedVersionId: 'v2' }))
    sites.listVersions.mockResolvedValue(
      ok([
        {
          id: 'v2',
          siteId: site.id,
          number: 2,
          publishedById: null,
          createdAt: new Date(),
          publishedBy: null,
        },
        {
          id: 'v1',
          siteId: site.id,
          number: 1,
          publishedById: 'u',
          createdAt: new Date(),
          publishedBy: { name: 'Ana' },
        },
      ]),
    )
    const list = expectOk(await SiteService.listVersions('u1', WS, site.id))
    expect(list.map((v) => v.isLive)).toEqual([true, false])
    sites.listVersions.mockResolvedValue(err(databaseError()))
    expectErr(
      await SiteService.listVersions('u1', WS, site.id),
      'DATABASE_ERROR',
    )
    sites.findById.mockResolvedValueOnce(err(appError('SITE_NOT_FOUND', 'x')))
    expectErr(
      await SiteService.listVersions('u1', WS, site.id),
      'SITE_NOT_FOUND',
    )
  })

  it('restores a version into the draft', async () => {
    const version = createFakeSiteVersion({ siteId: site.id, number: 3 })
    sites.findVersion.mockResolvedValue(ok(version))
    sites.replaceDraft.mockResolvedValue(ok(site))
    expectOk(await SiteService.restoreVersion('u1', WS, site.id, version.id))
    const input = sites.replaceDraft.mock.calls[0][1]
    expect(input.pages).toEqual([expect.objectContaining({ id: 'home' })])
    expect(input.homePageId).toBe('home')
    expect(input.updatedById).toBe('u1')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'restore' }),
    )
  })

  it('restores globals too', async () => {
    const snapshot = {
      ...(createFakeSiteVersion().snapshot as object),
      globals: [
        {
          id: 'g1',
          kind: 'HEADER',
          name: 'Topo',
          document: createSiteDocument(),
        },
      ],
    }
    sites.findVersion.mockResolvedValue(
      ok(createFakeSiteVersion({ snapshot: snapshot as never })),
    )
    sites.replaceDraft.mockResolvedValue(ok(site))
    expectOk(await SiteService.restoreVersion('u1', WS, site.id, 'v'))
    expect(sites.replaceDraft.mock.calls[0][1].globals).toEqual([
      expect.objectContaining({ id: 'g1', kind: 'HEADER' }),
    ])
  })

  it('refuses unreadable snapshots and propagates failures', async () => {
    sites.findVersion.mockResolvedValueOnce(
      ok(createFakeSiteVersion({ snapshot: { bogus: true } })),
    )
    expectErr(
      await SiteService.restoreVersion('u1', WS, site.id, 'v'),
      'SITE_DOCUMENT_INVALID',
    )
    sites.findVersion.mockResolvedValueOnce(
      err(appError('SITE_VERSION_NOT_FOUND', 'x')),
    )
    expectErr(
      await SiteService.restoreVersion('u1', WS, site.id, 'v'),
      'SITE_VERSION_NOT_FOUND',
    )
    sites.findVersion.mockResolvedValueOnce(ok(createFakeSiteVersion()))
    sites.replaceDraft.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteService.restoreVersion('u1', WS, site.id, 'v'),
      'DATABASE_ERROR',
    )
    sites.findById.mockResolvedValueOnce(err(appError('SITE_NOT_FOUND', 'x')))
    expectErr(
      await SiteService.restoreVersion('u1', WS, site.id, 'v'),
      'SITE_NOT_FOUND',
    )
  })
})
