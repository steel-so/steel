import type { Prisma, Role, Workspace } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSite,
  createFakeSiteGlobal,
  createFakeSitePage,
} from '@/src/__tests__/factories/site.factory'
import { searchDocument } from '@/src/__tests__/factories/site-search.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { heading, text } from '@/src/lib/canvas-site/presets/builder'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/site-page.repository')
vi.mock('@/src/repositories/site-global.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/repositories/crm-email-builder.repository')
vi.mock('@/lib/axiom/audit')

import { auditMutation } from '@/lib/axiom/audit'
import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { chromeTextOf, SiteSearchService } from '../site-search.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const pages = vi.mocked(SitePageRepository)
const globals = vi.mocked(SiteGlobalRepository)
const workspaces = vi.mocked(WorkspaceRepository)
const brands = vi.mocked(CrmEmailBuilderRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const audit = vi.mocked(auditMutation)

const WS = 'ws1'
const SITE = 'site1'
const json = (value: unknown) => value as Prisma.JsonValue

const BUSINESS = {
  name: 'Clínica Sorriso',
  phone: '(11) 3333-4444',
  address: { city: 'São Paulo', street: 'Rua A' },
}

function site(settings: unknown = {}) {
  return createFakeSite({
    id: SITE,
    workspaceId: WS,
    slug: 'sorriso',
    name: 'Sorriso',
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
  title: 'Início',
  slug: 'inicio',
  path: 'inicio',
  isHome: true,
  document: json(
    searchDocument(
      heading('h1', 'Clínica Sorriso'),
      text('<p>Ligue (11) 3333-4444.</p>'),
    ),
  ),
  seo: json({ title: 'Clínica Sorriso', search: { focusKeyword: 'dentista' } }),
})
const about = createFakeSitePage({
  id: 'about',
  siteId: SITE,
  title: 'Sobre',
  slug: 'sobre',
  path: 'sobre',
  document: json(searchDocument(heading('h2', 'Quem somos'))),
  seo: json({ title: 'Clínica Sorriso' }),
})

beforeEach(() => {
  asRole('MEMBER')
  sites.findById.mockResolvedValue(ok(site()))
  sites.update.mockImplementation(async (id, data) =>
    ok(
      createFakeSite({
        ...site(),
        id,
        settings: data.settings as Prisma.JsonValue,
      }),
    ),
  )
  pages.listWithDocuments.mockResolvedValue(ok([home, about]))
  pages.listBySite.mockResolvedValue(ok([home, about]))
  pages.update.mockImplementation(async (id, data) =>
    ok(createFakeSitePage({ id, seo: data.seo as Prisma.JsonValue })),
  )
  globals.listBySite.mockResolvedValue(
    ok([
      createFakeSiteGlobal({
        kind: 'FOOTER',
        document: json(searchDocument(text('<p>Rodapé (11) 3333-4444</p>'))),
      }),
      createFakeSiteGlobal({
        kind: 'SYMBOL',
        document: json(searchDocument(text('<p>Símbolo</p>'))),
      }),
    ]),
  )
  workspaces.findById.mockResolvedValue(
    ok({
      id: WS,
      name: 'Workspace Sorriso',
      logoUrl: 'https://cdn/logo.png',
    } as Workspace),
  )
  brands.findBrand.mockResolvedValue(ok(null))
})

describe('SiteSearchService authorization', () => {
  it('blocks non-members, a disabled module, viewers on writes and other workspaces', async () => {
    membership.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(await SiteSearchService.getSettings('u1', WS, SITE), 'FORBIDDEN')

    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(await SiteSearchService.report('u1', WS, SITE), 'MODULE_DISABLED')

    asRole('VIEWER')
    expectOk(await SiteSearchService.report('u1', WS, SITE))
    expectErr(
      await SiteSearchService.updateSettings('u1', WS, SITE, {
        llms: { enabled: false },
      }),
      'FORBIDDEN',
    )
    expectErr(
      await SiteSearchService.apply('u1', WS, SITE, {
        items: [{ pageId: 'home', title: 'Novo título' }],
      }),
      'FORBIDDEN',
    )

    asRole('MEMBER')
    sites.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteSearchService.getSettings('u1', 'other-ws', SITE),
      'DATABASE_ERROR',
    )
  })
})

describe('SiteSearchService.getSettings', () => {
  it('prefills an empty business profile from the workspace and the brand', async () => {
    brands.findBrand.mockResolvedValueOnce(
      ok({
        companyName: 'Sorriso Odonto',
        logoUrl: '',
        address: 'Rua B, 2',
        website: 'https://sorriso.com',
      } as never),
    )
    const view = expectOk(await SiteSearchService.getSettings('u1', WS, SITE))
    expect(view.prefilled).toBe(true)
    expect(view.settings.business).toEqual({
      name: 'Sorriso Odonto',
      address: { street: 'Rua B, 2' },
      logoUrl: 'https://cdn/logo.png',
      sameAs: ['https://sorriso.com'],
    })
    expect(view.urls.llms).toMatch(/\/llms\.txt$/)
    expect(view.urls.indexNowKey).toBeNull()
    expect(view.published).toBe(false)
  })

  it('survives lookup failures while prefilling', async () => {
    workspaces.findById.mockResolvedValueOnce(err(databaseError('x')))
    brands.findBrand.mockResolvedValueOnce(err(databaseError('x')))
    const view = expectOk(await SiteSearchService.getSettings('u1', WS, SITE))
    expect(view.settings.business).toEqual({ name: 'Sorriso' })
  })

  it('returns the saved profile and the IndexNow key file', async () => {
    sites.findById.mockResolvedValueOnce(
      ok({
        ...site({
          search: {
            business: BUSINESS,
            indexNow: { enabled: true, key: 'abcdef12' },
          },
        }),
        status: 'PUBLISHED',
      }),
    )
    const view = expectOk(await SiteSearchService.getSettings('u1', WS, SITE))
    expect(view.prefilled).toBe(false)
    expect(view.settings.business.name).toBe('Clínica Sorriso')
    expect(view.urls.indexNowKey).toMatch(/\/indexnow-key\.txt$/)
    expect(view.published).toBe(true)
    expect(workspaces.findById).not.toHaveBeenCalled()
  })
})

describe('SiteSearchService.updateSettings', () => {
  it('merges the blocks, generates the IndexNow key once and keeps other settings', async () => {
    sites.findById.mockResolvedValueOnce(
      ok(
        site({
          seo: { titleTemplate: '%s | Sorriso' },
          search: { crawlers: { GPTBot: false } },
        }),
      ),
    )
    const view = expectOk(
      await SiteSearchService.updateSettings('u1', WS, SITE, {
        business: BUSINESS,
        indexNow: { enabled: true },
        verification: { google: 'abc' },
      }),
    )
    const saved = sites.update.mock.calls[0][1].settings as Record<
      string,
      never
    >
    expect(saved.seo).toEqual({ titleTemplate: '%s | Sorriso' })
    expect(view.settings.crawlers).toEqual({ GPTBot: false })
    expect(view.settings.indexNow.key).toMatch(/^[a-f0-9]{32}$/)
    expect(view.settings.verification).toEqual({ google: 'abc' })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'site',
        meta: {
          scope: 'search',
          fields: ['business', 'indexNow', 'verification'],
        },
      }),
    )
  })

  it('keeps an existing key when IndexNow goes off, and none when never on', async () => {
    sites.findById.mockResolvedValueOnce(
      ok(site({ search: { indexNow: { enabled: true, key: 'abcdef12' } } })),
    )
    const off = expectOk(
      await SiteSearchService.updateSettings('u1', WS, SITE, {
        indexNow: { enabled: false },
      }),
    )
    expect(off.settings.indexNow).toEqual({ enabled: false, key: 'abcdef12' })

    const never = expectOk(
      await SiteSearchService.updateSettings('u1', WS, SITE, {
        crawlers: { CCBot: false },
        llms: { enabled: false },
      }),
    )
    expect(never.settings.indexNow).toEqual({ enabled: false })
    expect(never.settings.llms).toEqual({ enabled: false })
  })

  it('propagates database errors', async () => {
    sites.update.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteSearchService.updateSettings('u1', WS, SITE, {
        llms: { enabled: true },
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('SiteSearchService.report', () => {
  it('scores every draft page and ranks the issues', async () => {
    const report = expectOk(
      await SiteSearchService.report(
        'u1',
        WS,
        SITE,
        new Date('2026-10-15T00:00:00Z'),
      ),
    )
    expect(report.pages.map((page) => [page.id, page.path])).toEqual([
      ['home', '/'],
      ['about', '/sobre'],
    ])
    expect(report.generatedAt).toBe('2026-10-15T00:00:00.000Z')
    // Same title on both pages.
    expect(report.issues.some((issue) => issue.checkId === 'seo.unique')).toBe(
      true,
    )
    expect(report.completeness.percent).toBeGreaterThanOrEqual(0)
  })

  it('treats the flagged page as home when the site has no home id', async () => {
    sites.findById.mockResolvedValueOnce(ok({ ...site(), homePageId: null }))
    const report = expectOk(await SiteSearchService.report('u1', WS, SITE))
    expect(report.pages[0].path).toBe('/')
  })

  it('propagates database errors', async () => {
    pages.listWithDocuments.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await SiteSearchService.report('u1', WS, SITE), 'DATABASE_ERROR')
    globals.listBySite.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await SiteSearchService.report('u1', WS, SITE), 'DATABASE_ERROR')
  })

  it('reads the header and footer text only', () => {
    expect(
      chromeTextOf([
        createFakeSiteGlobal({
          kind: 'HEADER',
          document: json(searchDocument(text('<p>Topo</p>'))),
        }),
        createFakeSiteGlobal({
          kind: 'SYMBOL',
          document: json(searchDocument(text('<p>Não</p>'))),
        }),
      ]),
    ).toBe('Topo')
  })
})

describe('SiteSearchService.apply', () => {
  it('saves titles, descriptions and merges answers', async () => {
    pages.listBySite.mockResolvedValueOnce(
      ok([
        createFakeSitePage({
          id: 'home',
          seo: json({
            title: 'Antigo',
            noindex: false,
            search: {
              focusKeyword: 'dentista',
              questions: [{ question: 'Dói?', answer: 'Velha' }],
            },
          }),
        }),
        createFakeSitePage({ id: 'about', seo: json({}) }),
      ]),
    )
    const result = expectOk(
      await SiteSearchService.apply('u1', WS, SITE, {
        items: [
          {
            pageId: 'home',
            title: 'Dentista em São Paulo',
            description: 'Nova descrição',
            questions: [
              { question: 'dói?', answer: 'Nova resposta' },
              { question: 'Quanto custa?', answer: 'Depende' },
            ],
          },
          { pageId: 'about', title: 'Sobre a clínica' },
        ],
      }),
    )
    expect(result.updated).toEqual(['home', 'about'])
    expect(pages.update.mock.calls[0][1].seo).toEqual({
      title: 'Dentista em São Paulo',
      description: 'Nova descrição',
      noindex: false,
      search: {
        focusKeyword: 'dentista',
        questions: [
          { question: 'Dói?', answer: 'Nova resposta' },
          { question: 'Quanto custa?', answer: 'Depende' },
        ],
      },
    })
    expect(pages.update.mock.calls[1][1].seo).toEqual({
      title: 'Sobre a clínica',
      search: {},
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'site_page',
        meta: { scope: 'search-ai-apply', pages: ['home', 'about'] },
      }),
    )
  })

  it('refuses unknown pages and propagates errors', async () => {
    expectErr(
      await SiteSearchService.apply('u1', WS, SITE, {
        items: [{ pageId: 'nope', title: 'X' }],
      }),
      'SITE_PAGE_NOT_FOUND',
    )
    pages.listBySite.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteSearchService.apply('u1', WS, SITE, {
        items: [{ pageId: 'home', title: 'X' }],
      }),
      'DATABASE_ERROR',
    )
    pages.update.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SiteSearchService.apply('u1', WS, SITE, {
        items: [{ pageId: 'home', title: 'X' }],
      }),
      'DATABASE_ERROR',
    )
  })
})
