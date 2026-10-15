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
vi.mock('@/src/lib/sites/templates', async (original) => ({
  ...(await original<typeof import('@/src/lib/sites/templates')>()),
}))

import { auditMutation } from '@/lib/axiom/audit'
import * as templates from '@/src/lib/sites/templates'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import { MAX_SITES_PER_WORKSPACE } from '../site.service'
import { SiteStudioService } from '../site-studio.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const pages = vi.mocked(SitePageRepository)
const globals = vi.mocked(SiteGlobalRepository)
const audit = vi.mocked(auditMutation)

const WS = 'ws1'
const site = createFakeSite({
  id: 'site1',
  workspaceId: WS,
  slug: 'clinica',
  homePageId: 'home',
  theme: { colors: { primary: '#111111' } },
})

function asRole(role: Role) {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  asRole('OWNER')
  sites.findById.mockResolvedValue(ok(site))
  sites.countByWorkspace.mockResolvedValue(ok(1))
  sites.isSlugTaken.mockResolvedValue(ok(false))
  sites.createWithPages.mockImplementation(async (data) =>
    ok(createFakeSite({ ...data.site, id: 'new' })),
  )
})

describe('SiteStudioService.createFromTemplate', () => {
  it('creates the site with the template home page and globals', async () => {
    const created = expectOk(
      await SiteStudioService.createFromTemplate('u1', WS, {
        name: 'Clínica Nova',
        templateId: 'agencia',
      }),
    )
    expect(created.id).toBe('new')
    const input = sites.createWithPages.mock.calls[0][0]
    expect(input.site).toMatchObject({
      workspaceId: WS,
      createdById: 'u1',
      slug: 'clinica-nova',
    })
    expect(input.pages).toHaveLength(1)
    expect(input.pages[0]).toMatchObject({ isHome: true, path: 'inicio' })
    expect(input.globals.map((global) => global.kind)).toEqual([
      'HEADER',
      'FOOTER',
    ])
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', targetId: 'new' }),
    )
  })

  it('keeps a given slug and skips missing globals', async () => {
    vi.spyOn(templates, 'buildSiteFromTemplate').mockReturnValueOnce({
      theme: {} as never,
      home: createSiteDocument(),
      header: null,
      footer: null,
    })
    expectOk(
      await SiteStudioService.createFromTemplate('u1', WS, {
        name: 'X',
        slug: 'meu-site',
        templateId: 'agencia',
      }),
    )
    const input = sites.createWithPages.mock.calls[0][0]
    expect(input.site.slug).toBe('meu-site')
    expect(input.globals).toEqual([])
    expect(sites.isSlugTaken).not.toHaveBeenCalled()
  })

  it('refuses viewers, a full workspace and unknown templates', async () => {
    asRole('VIEWER')
    expectErr(
      await SiteStudioService.createFromTemplate('u1', WS, {
        name: 'X',
        templateId: 'agencia',
      }),
      'FORBIDDEN',
    )
    asRole('OWNER')
    sites.countByWorkspace.mockResolvedValueOnce(ok(MAX_SITES_PER_WORKSPACE))
    expectErr(
      await SiteStudioService.createFromTemplate('u1', WS, {
        name: 'X',
        templateId: 'agencia',
      }),
      'SITE_LIMIT_REACHED',
    )
    sites.countByWorkspace.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteStudioService.createFromTemplate('u1', WS, {
        name: 'X',
        templateId: 'agencia',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await SiteStudioService.createFromTemplate('u1', WS, {
        name: 'X',
        templateId: 'nope',
      }),
      'VALIDATION_ERROR',
    )
    expect(sites.createWithPages).not.toHaveBeenCalled()
  })

  it('propagates slug lookup and insert failures', async () => {
    sites.isSlugTaken.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteStudioService.createFromTemplate('u1', WS, {
        name: 'X',
        templateId: 'agencia',
      }),
      'DATABASE_ERROR',
    )
    sites.createWithPages.mockResolvedValueOnce(
      err(appError('SITE_SLUG_TAKEN', 'Em uso')),
    )
    expectErr(
      await SiteStudioService.createFromTemplate('u1', WS, {
        name: 'X',
        templateId: 'agencia',
      }),
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

describe('SiteStudioService.duplicate', () => {
  const home = createFakeSitePage({ id: 'home', isHome: true, siteId: 'site1' })
  const child = createFakeSitePage({
    id: 'child',
    parentId: 'home',
    title: 'Equipe',
    path: 'inicio/equipe',
    position: 1,
    siteId: 'site1',
    seo: null as never,
  })
  const orphan = createFakeSitePage({
    id: 'orphan',
    parentId: 'gone',
    path: 'x',
    siteId: 'site1',
  })

  beforeEach(() => {
    pages.listWithDocuments.mockResolvedValue(ok([home, child, orphan]))
    globals.listBySite.mockResolvedValue(
      ok([createFakeSiteGlobal({ kind: 'FOOTER', name: 'Rodapé' })]),
    )
  })

  it('copies pages with fresh ids, the tree and the globals', async () => {
    expectOk(await SiteStudioService.duplicate('u1', WS, 'site1', {}))
    const input = sites.createWithPages.mock.calls[0][0]
    expect(input.site).toMatchObject({
      name: 'Clínica São Lucas (cópia)',
      slug: 'clinica-copia',
      theme: site.theme,
    })
    const [copyHome, copyChild, copyOrphan] = input.pages
    expect(copyHome.id).not.toBe('home')
    expect(copyHome.isHome).toBe(true)
    expect(copyChild.parentId).toBe(copyHome.id)
    expect(copyChild.isHome).toBe(false)
    expect(copyChild.seo).toEqual({})
    expect(copyOrphan.parentId).toBeNull()
    expect(input.globals).toEqual([
      expect.objectContaining({ kind: 'FOOTER', name: 'Rodapé' }),
    ])
  })

  it('uses the page flag when the site has no home id and a given name', async () => {
    sites.findById.mockResolvedValueOnce(
      ok({ ...site, homePageId: null, slug: 'abc' }),
    )
    expectOk(
      await SiteStudioService.duplicate('u1', WS, 'site1', { name: 'Novo' }),
    )
    const input = sites.createWithPages.mock.calls[0][0]
    expect(input.site.name).toBe('Novo')
    expect(input.pages.map((page) => page.isHome)).toEqual([true, false, false])
  })

  it('propagates authorization and read failures', async () => {
    sites.findById.mockResolvedValueOnce(
      err(appError('SITE_NOT_FOUND', 'Site não encontrado')),
    )
    expectErr(
      await SiteStudioService.duplicate('u1', WS, 'site1', {}),
      'SITE_NOT_FOUND',
    )
    asRole('VIEWER')
    expectErr(
      await SiteStudioService.duplicate('u1', WS, 'site1', {}),
      'FORBIDDEN',
    )
    asRole('OWNER')
    pages.listWithDocuments.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteStudioService.duplicate('u1', WS, 'site1', {}),
      'DATABASE_ERROR',
    )
    globals.listBySite.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteStudioService.duplicate('u1', WS, 'site1', {}),
      'DATABASE_ERROR',
    )
    sites.isSlugTaken.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteStudioService.duplicate('u1', WS, 'site1', {}),
      'DATABASE_ERROR',
    )
    sites.createWithPages.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteStudioService.duplicate('u1', WS, 'site1', {}),
      'DATABASE_ERROR',
    )
  })
})

describe('SiteStudioService.pendingChanges', () => {
  const home = createFakeSitePage({
    id: 'home',
    isHome: true,
    document: createSiteDocument('Olá') as never,
  })

  beforeEach(() => {
    pages.listWithDocuments.mockResolvedValue(ok([home]))
    globals.listBySite.mockResolvedValue(ok([]))
  })

  it('lists everything as new before the first publish', async () => {
    const changes = expectOk(
      await SiteStudioService.pendingChanges('u1', WS, 'site1'),
    )
    expect(changes.firstPublish).toBe(true)
    expect(changes.pages).toHaveLength(1)
    expect(sites.findVersion).not.toHaveBeenCalled()
  })

  it('compares the draft with the live version', async () => {
    const published = { ...site, publishedVersionId: 'v1' }
    sites.findById.mockResolvedValue(ok(published))
    const createdAt = new Date('2026-10-10T12:00:00Z')
    // Live = the current draft, so only the edited title shows up.
    const live = await import('@/src/lib/sites/snapshot').then((module) =>
      module.buildSiteSnapshot({
        name: published.name,
        theme: published.theme,
        settings: published.settings,
        homePageId: published.homePageId,
        pages: [{ ...home, title: 'Antigo' }],
        globals: [],
      }),
    )
    sites.findVersion.mockResolvedValueOnce(
      ok(createFakeSiteVersion({ snapshot: live as never, createdAt })),
    )
    const changes = expectOk(
      await SiteStudioService.pendingChanges('u1', WS, 'site1'),
    )
    expect(changes).toMatchObject({
      firstPublish: false,
      publishedAt: createdAt.toISOString(),
      total: 1,
      pages: [{ id: 'home', change: 'changed' }],
    })
    expect(sites.findVersion).toHaveBeenCalledWith('site1', 'v1')

    // An unreadable live snapshot counts as a first publish.
    sites.findVersion.mockResolvedValueOnce(
      ok(createFakeSiteVersion({ snapshot: { bad: true } as never })),
    )
    expect(
      expectOk(await SiteStudioService.pendingChanges('u1', WS, 'site1'))
        .firstPublish,
    ).toBe(true)
  })

  it('propagates failures', async () => {
    asRole('VIEWER')
    expectOk(await SiteStudioService.pendingChanges('u1', WS, 'site1'))
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await SiteStudioService.pendingChanges('u1', WS, 'site1'),
      'FORBIDDEN',
    )
    asRole('OWNER')
    pages.listWithDocuments.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteStudioService.pendingChanges('u1', WS, 'site1'),
      'DATABASE_ERROR',
    )
    sites.findById.mockResolvedValue(ok({ ...site, publishedVersionId: 'v1' }))
    sites.findVersion.mockResolvedValueOnce(
      err(appError('SITE_VERSION_NOT_FOUND', 'Versão não encontrada')),
    )
    expectErr(
      await SiteStudioService.pendingChanges('u1', WS, 'site1'),
      'SITE_VERSION_NOT_FOUND',
    )
  })
})
