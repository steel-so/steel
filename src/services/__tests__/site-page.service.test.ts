import type { SitePage } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSite,
  createFakeSitePage,
  createSiteDocument,
} from '@/src/__tests__/factories/site.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/site-page.repository')
vi.mock('@/lib/axiom/audit')

import { auditMutation } from '@/lib/axiom/audit'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import {
  checkSiteDocument,
  MAX_PAGES_PER_SITE,
  SitePageService,
} from '../site-page.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const pages = vi.mocked(SitePageRepository)
const audit = vi.mocked(auditMutation)

const WS = 'ws1'
const SITE = 'site1'
const site = createFakeSite({ id: SITE, workspaceId: WS, homePageId: 'home' })

const page = (overrides: Partial<SitePage>) =>
  createFakeSitePage({ siteId: SITE, ...overrides })

const home = page({ id: 'home', isHome: true, slug: 'inicio', path: 'inicio' })
const servicos = page({ id: 'servicos', slug: 'servicos', path: 'servicos' })
const consultoria = page({
  id: 'consultoria',
  parentId: 'servicos',
  slug: 'consultoria',
  path: 'servicos/consultoria',
})
const remota = page({
  id: 'remota',
  parentId: 'consultoria',
  slug: 'remota',
  path: 'servicos/consultoria/remota',
})
const contato = page({ id: 'contato', slug: 'contato', path: 'contato' })
const tree = [home, servicos, consultoria, remota, contato]

beforeEach(() => {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  sites.findById.mockResolvedValue(ok(site))
  pages.listBySite.mockResolvedValue(ok(tree))
  pages.create.mockImplementation(async (data) =>
    ok(
      page({
        ...data,
        document: data.document as never,
        seo: data.seo as never,
      }),
    ),
  )
  pages.update.mockImplementation(async (id, data) =>
    ok(page({ id, ...(data as Partial<SitePage>) })),
  )
})

describe('checkSiteDocument', () => {
  it('returns the document or every problem', () => {
    expect(checkSiteDocument(createSiteDocument()).ok).toBe(true)
    const error = expectErr(checkSiteDocument({}), 'SITE_DOCUMENT_INVALID')
    expect(Array.isArray(error.details)).toBe(true)
  })
})

describe('SitePageService authorization', () => {
  it('lets viewers read but not write', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'VIEWER' })),
    )
    expectOk(await SitePageService.list('u1', WS, SITE))
    expectErr(
      await SitePageService.create('u1', WS, SITE, { title: 'x' }),
      'FORBIDDEN',
    )
    expectErr(
      await SitePageService.remove('u1', WS, SITE, 'contato'),
      'FORBIDDEN',
    )
  })

  it('propagates a site from another workspace', async () => {
    sites.findById.mockResolvedValue(err(appError('SITE_NOT_FOUND', 'x')))
    for (const call of [
      () => SitePageService.list('u1', WS, SITE),
      () => SitePageService.get('u1', WS, SITE, 'home'),
      () => SitePageService.create('u1', WS, SITE, { title: 'x' }),
      () => SitePageService.update('u1', WS, SITE, 'home', { title: 'x' }),
      () => SitePageService.remove('u1', WS, SITE, 'home'),
      () => SitePageService.reorder('u1', WS, SITE, ['home']),
      () => SitePageService.duplicate('u1', WS, SITE, 'home', {}),
    ]) {
      expectErr(await call(), 'SITE_NOT_FOUND')
    }
  })

  it('propagates page list failures on every write', async () => {
    pages.listBySite.mockResolvedValue(err(databaseError()))
    for (const call of [
      () => SitePageService.list('u1', WS, SITE),
      () => SitePageService.create('u1', WS, SITE, { title: 'x' }),
      () => SitePageService.update('u1', WS, SITE, 'home', { title: 'x' }),
      () => SitePageService.remove('u1', WS, SITE, 'home'),
      () => SitePageService.reorder('u1', WS, SITE, ['home']),
    ]) {
      expectErr(await call(), 'DATABASE_ERROR')
    }
  })
})

describe('SitePageService reads', () => {
  it('lists summaries and gets a page with its document', async () => {
    const list = expectOk(await SitePageService.list('u1', WS, SITE))
    expect(list.map((p) => p.id)).toEqual(tree.map((p) => p.id))
    pages.findById.mockResolvedValue(ok(home))
    expect(
      expectOk(await SitePageService.get('u1', WS, SITE, 'home')).document,
    ).toBeDefined()
    pages.findById.mockResolvedValue(err(appError('SITE_PAGE_NOT_FOUND', 'x')))
    expectErr(
      await SitePageService.get('u1', WS, SITE, 'x'),
      'SITE_PAGE_NOT_FOUND',
    )
  })
})

describe('SitePageService.create', () => {
  it('derives a free slug under the parent and starts blank', async () => {
    pages.listBySite.mockResolvedValue(
      ok([...tree, page({ slug: 'contato-2', path: 'contato-2' })]),
    )
    expectOk(await SitePageService.create('u1', WS, SITE, { title: 'Contato' }))
    expect(pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'contato-3',
        path: 'contato-3',
        parentId: null,
        seo: {},
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'site_page', action: 'create' }),
    )
  })

  it('nests under a parent with an explicit slug and document', async () => {
    await SitePageService.create('u1', WS, SITE, {
      title: 'Online',
      slug: 'online',
      parentId: 'consultoria',
      document: createSiteDocument(),
      seo: { title: 'Online' },
    })
    expect(pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'servicos/consultoria/online',
        seo: { title: 'Online' },
      }),
    )
  })

  it('falls back to a time suffix after many collisions', async () => {
    const crowded = Array.from({ length: 50 }, (_, i) =>
      page({ path: i === 0 ? 'faq' : `faq-${i + 1}` }),
    )
    pages.listBySite.mockResolvedValue(ok(crowded))
    await SitePageService.create('u1', WS, SITE, { title: 'FAQ' })
    expect(pages.create.mock.calls[0][0].slug).toMatch(/^faq-[a-z0-9]+$/)
    expect(pages.create.mock.calls[0][0].slug).not.toBe('faq-51')
  })

  it('enforces limits, parents, depth and the document', async () => {
    pages.listBySite.mockResolvedValueOnce(
      ok(Array.from({ length: MAX_PAGES_PER_SITE }, () => page({}))),
    )
    expectErr(
      await SitePageService.create('u1', WS, SITE, { title: 'x' }),
      'SITE_LIMIT_REACHED',
    )
    expectErr(
      await SitePageService.create('u1', WS, SITE, {
        title: 'x',
        parentId: 'ghost',
      }),
      'SITE_PAGE_NOT_FOUND',
    )
    expectErr(
      await SitePageService.create('u1', WS, SITE, {
        title: 'x',
        parentId: 'remota',
      }),
      'SITE_PAGE_PROTECTED',
    )
    expectErr(
      await SitePageService.create('u1', WS, SITE, {
        title: 'x',
        document: { a: 1 } as never,
      }),
      'SITE_DOCUMENT_INVALID',
    )
    pages.create.mockResolvedValueOnce(
      err(appError('SITE_PAGE_PATH_TAKEN', 'x')),
    )
    expectErr(
      await SitePageService.create('u1', WS, SITE, {
        title: 'x',
        slug: 'contato',
      }),
      'SITE_PAGE_PATH_TAKEN',
    )
  })
})

describe('SitePageService.update', () => {
  it('renames a page and rewrites its subtree paths', async () => {
    expectOk(
      await SitePageService.update('u1', WS, SITE, 'servicos', {
        slug: 'solucoes',
        title: 'Soluções',
        seo: { noindex: true },
        document: createSiteDocument(),
      }),
    )
    const [id, data, descendants] = pages.update.mock.calls[0]
    expect(id).toBe('servicos')
    expect(data).toMatchObject({
      path: 'solucoes',
      title: 'Soluções',
      seo: { noindex: true },
    })
    expect(descendants).toEqual([
      { id: 'consultoria', path: 'solucoes/consultoria' },
      { id: 'remota', path: 'solucoes/consultoria/remota' },
    ])
  })

  it('keeps paths when only content changes', async () => {
    await SitePageService.update('u1', WS, SITE, 'contato', { title: 'Fale' })
    const [, data, descendants] = pages.update.mock.calls[0]
    expect(data.path).toBeUndefined()
    expect(data.document).toBeUndefined()
    expect(descendants).toEqual([])
  })

  it('moves a page under another parent and back to the root', async () => {
    await SitePageService.update('u1', WS, SITE, 'contato', {
      parentId: 'servicos',
    })
    expect(pages.update.mock.calls[0][1].path).toBe('servicos/contato')
    await SitePageService.update('u1', WS, SITE, 'consultoria', {
      parentId: null,
    })
    expect(pages.update.mock.calls[1][2]).toEqual([
      { id: 'remota', path: 'consultoria/remota' },
    ])
  })

  it('refuses cycles, depth overflow, unknown pages and bad documents', async () => {
    expectErr(
      await SitePageService.update('u1', WS, SITE, 'ghost', { title: 'x' }),
      'SITE_PAGE_NOT_FOUND',
    )
    expectErr(
      await SitePageService.update('u1', WS, SITE, 'contato', {
        parentId: 'ghost',
      }),
      'SITE_PAGE_NOT_FOUND',
    )
    expectErr(
      await SitePageService.update('u1', WS, SITE, 'servicos', {
        parentId: 'remota',
      }),
      'SITE_PAGE_PROTECTED',
    )
    expectErr(
      await SitePageService.update('u1', WS, SITE, 'servicos', {
        parentId: 'contato',
      }),
      'SITE_PAGE_PROTECTED',
    )
    expectErr(
      await SitePageService.update('u1', WS, SITE, 'contato', {
        document: {} as never,
      }),
      'SITE_DOCUMENT_INVALID',
    )
    pages.update.mockResolvedValueOnce(
      err(appError('SITE_PAGE_PATH_TAKEN', 'x')),
    )
    expectErr(
      await SitePageService.update('u1', WS, SITE, 'contato', {
        slug: 'servicos',
      }),
      'SITE_PAGE_PATH_TAKEN',
    )
  })
})

describe('SitePageService.remove', () => {
  it('deletes a leaf page', async () => {
    pages.delete.mockResolvedValue(ok(undefined))
    expectOk(await SitePageService.remove('u1', WS, SITE, 'contato'))
    expect(pages.delete).toHaveBeenCalledWith('contato')
    pages.delete.mockResolvedValue(err(databaseError()))
    expectErr(
      await SitePageService.remove('u1', WS, SITE, 'contato'),
      'DATABASE_ERROR',
    )
  })

  it('protects the home page and pages with children', async () => {
    expectErr(
      await SitePageService.remove('u1', WS, SITE, 'ghost'),
      'SITE_PAGE_NOT_FOUND',
    )
    expectErr(
      await SitePageService.remove('u1', WS, SITE, 'home'),
      'SITE_PAGE_PROTECTED',
    )
    expectErr(
      await SitePageService.remove('u1', WS, SITE, 'servicos'),
      'SITE_PAGE_PROTECTED',
    )
    sites.findById.mockResolvedValue(ok({ ...site, homePageId: 'contato' }))
    expectErr(
      await SitePageService.remove('u1', WS, SITE, 'contato'),
      'SITE_PAGE_PROTECTED',
    )
    expect(pages.delete).not.toHaveBeenCalled()
  })
})

describe('SitePageService.reorder', () => {
  it('reorders known pages only', async () => {
    pages.reorder.mockResolvedValue(ok(undefined))
    expectOk(await SitePageService.reorder('u1', WS, SITE, ['contato', 'home']))
    expect(pages.reorder).toHaveBeenCalledWith(SITE, ['contato', 'home'])
    expectErr(
      await SitePageService.reorder('u1', WS, SITE, ['other-site-page']),
      'SITE_PAGE_NOT_FOUND',
    )
    pages.reorder.mockResolvedValue(err(databaseError()))
    expectErr(
      await SitePageService.reorder('u1', WS, SITE, ['home']),
      'DATABASE_ERROR',
    )
  })
})

describe('SitePageService.duplicate', () => {
  beforeEach(() => {
    pages.findById.mockResolvedValue(ok(consultoria))
  })

  it('copies a page under the same parent', async () => {
    expectOk(await SitePageService.duplicate('u1', WS, SITE, 'consultoria', {}))
    expect(pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: 'servicos',
        title: `${consultoria.title} (cópia)`,
        slug: 'consultoria-copia',
        path: 'servicos/consultoria-copia',
      }),
    )
    await SitePageService.duplicate('u1', WS, SITE, 'consultoria', {
      title: 'B',
    })
    expect(pages.create.mock.calls[1][0].title).toBe('B')
  })

  it('copies a root page', async () => {
    pages.findById.mockResolvedValue(ok(contato))
    await SitePageService.duplicate('u1', WS, SITE, 'contato', {})
    expect(pages.create.mock.calls[0][0].path).toBe('contato-copia')
  })

  it('propagates lookups, limits and insert failures', async () => {
    pages.findById.mockResolvedValueOnce(
      err(appError('SITE_PAGE_NOT_FOUND', 'x')),
    )
    expectErr(
      await SitePageService.duplicate('u1', WS, SITE, 'x', {}),
      'SITE_PAGE_NOT_FOUND',
    )
    pages.listBySite.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SitePageService.duplicate('u1', WS, SITE, 'consultoria', {}),
      'DATABASE_ERROR',
    )
    pages.listBySite.mockResolvedValueOnce(
      ok(Array.from({ length: MAX_PAGES_PER_SITE }, () => page({}))),
    )
    expectErr(
      await SitePageService.duplicate('u1', WS, SITE, 'consultoria', {}),
      'SITE_LIMIT_REACHED',
    )
    pages.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SitePageService.duplicate('u1', WS, SITE, 'consultoria', {}),
      'DATABASE_ERROR',
    )
  })
})
