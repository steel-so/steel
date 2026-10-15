import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { seedCrmForm } from '@/src/__tests__/factories/crm-form.factory'
import { seedCrmLandingPage } from '@/src/__tests__/factories/crm-landing-page.factory'
import {
  createSiteDocument,
  seedSite,
  seedSitePage,
} from '@/src/__tests__/factories/site.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { isUniqueViolation, SiteRepository } from '../site.repository'

const doc = createSiteDocument() as unknown as Prisma.InputJsonValue

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  return { workspace, user }
}

function pageInput(overrides: Record<string, unknown> = {}) {
  return {
    parentId: null,
    title: 'Início',
    slug: 'inicio',
    path: 'inicio',
    position: 0,
    isHome: true,
    seo: {},
    document: doc,
    ...overrides,
  }
}

describe('isUniqueViolation', () => {
  it('detects Prisma P2002', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true)
    expect(isUniqueViolation({ code: 'P2025' })).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})

describe('SiteRepository', () => {
  it('creates a site with pages and globals, sets the home page and lists it', async () => {
    const { workspace, user } = await setup()
    const site = expectOk(
      await SiteRepository.createWithPages({
        site: {
          workspaceId: workspace.id,
          createdById: user.id,
          name: 'Clínica',
          slug: 'clinica-repo',
          theme: {},
          settings: {},
        },
        pages: [
          pageInput({
            id: 'child-page',
            parentId: 'home-page',
            isHome: false,
            slug: 'filho',
            path: 'inicio/filho',
          }),
          pageInput({ id: 'home-page' }),
        ],
        globals: [{ kind: 'HEADER', name: 'Topo', document: doc }],
      }),
    )
    expect(site.homePageId).toBe('home-page')
    expect(await prisma.siteGlobal.count({ where: { siteId: site.id } })).toBe(
      1,
    )

    const list = expectOk(await SiteRepository.listByWorkspace(workspace.id))
    expect(list.map((s) => [s.id, s._count.pages])).toEqual([[site.id, 2]])
    expect(expectOk(await SiteRepository.countByWorkspace(workspace.id))).toBe(
      1,
    )
    expect(
      expectOk(await SiteRepository.findById(site.id, workspace.id)).id,
    ).toBe(site.id)
  })

  it('creates a site without globals', async () => {
    const { workspace, user } = await setup()
    const site = expectOk(
      await SiteRepository.createWithPages({
        site: {
          workspaceId: workspace.id,
          createdById: user.id,
          name: 'Sem globais',
          slug: 'sem-globais',
          theme: {},
          settings: {},
          sourceLandingPageId: 'landing-x',
        },
        pages: [pageInput({ isHome: false })],
        globals: [],
      }),
    )
    expect(site.homePageId).toBeNull()
    expect(site.sourceLandingPageId).toBe('landing-x')
  })

  it('maps a slug collision to SITE_SLUG_TAKEN', async () => {
    const { workspace, user } = await setup()
    await seedSite(workspace.id, user.id, { slug: 'taken-slug' })
    const input = {
      site: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'x',
        slug: 'taken-slug',
        theme: {},
        settings: {},
      },
      pages: [pageInput()],
      globals: [],
    }
    expectErr(await SiteRepository.createWithPages(input), 'SITE_SLUG_TAKEN')
    const other = await seedSite(workspace.id, user.id)
    expectErr(
      await SiteRepository.update(other.id, {
        slug: 'taken-slug',
        updatedById: user.id,
      }),
      'SITE_SLUG_TAKEN',
    )
    expect(expectOk(await SiteRepository.isSlugTaken('taken-slug'))).toBe(true)
    expect(
      expectOk(await SiteRepository.isSlugTaken('taken-slug', other.id)),
    ).toBe(true)
    expect(expectOk(await SiteRepository.isSlugTaken('free-slug'))).toBe(false)
  })

  it('scopes reads to the workspace and hides deleted sites', async () => {
    const { workspace, user } = await setup()
    const other = await seedWorkspace()
    const site = await seedSite(workspace.id, user.id, { slug: 'escopo' })
    expectErr(
      await SiteRepository.findById(site.id, other.id),
      'SITE_NOT_FOUND',
    )

    expectOk(await SiteRepository.softDelete(site.id, site.slug))
    expectErr(
      await SiteRepository.findById(site.id, workspace.id),
      'SITE_NOT_FOUND',
    )
    expect(expectOk(await SiteRepository.isSlugTaken('escopo'))).toBe(false)
    expect(
      expectOk(await SiteRepository.listByWorkspace(workspace.id)),
    ).toEqual([])
  })

  it('publishes numbered versions, serves the live one and unpublishes', async () => {
    const { workspace, user } = await setup()
    const site = await seedSite(workspace.id, user.id, { slug: 'publica' })
    expectErr(
      await SiteRepository.findPublishedBySlug('publica'),
      'SITE_NOT_FOUND',
    )

    const first = expectOk(
      await SiteRepository.publish(site.id, { v: 1 }, user.id),
    )
    const second = expectOk(
      await SiteRepository.publish(site.id, { v: 2 }, user.id),
    )
    expect([first.version.number, second.version.number]).toEqual([1, 2])
    expect(second.site.status).toBe('PUBLISHED')
    expect(second.site.publishedVersionId).toBe(second.version.id)

    const live = expectOk(await SiteRepository.findPublishedBySlug('publica'))
    expect(live.publishedVersion.snapshot).toEqual({ v: 2 })

    const versions = expectOk(await SiteRepository.listVersions(site.id))
    expect(versions.map((v) => v.number)).toEqual([2, 1])
    expect(versions[0].publishedBy?.name).toBe(user.name)
    expect(
      expectOk(await SiteRepository.findVersion(site.id, first.version.id))
        .number,
    ).toBe(1)
    expectErr(
      await SiteRepository.findVersion('other', first.version.id),
      'SITE_VERSION_NOT_FOUND',
    )

    const offline = expectOk(await SiteRepository.unpublish(site.id, user.id))
    expect(offline.status).toBe('DRAFT')
    expectErr(
      await SiteRepository.findPublishedBySlug('publica'),
      'SITE_NOT_FOUND',
    )
  })

  it('maps a concurrent publish to CONFLICT', async () => {
    const { workspace, user } = await setup()
    const site = await seedSite(workspace.id, user.id)
    const spy = vi
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockRejectedValueOnce(new Error('boom'))
    expectErr(await SiteRepository.publish(site.id, {}, user.id), 'CONFLICT')
    expectErr(
      await SiteRepository.publish(site.id, {}, user.id),
      'DATABASE_ERROR',
    )
    spy.mockRestore()
  })

  it('replaces the draft with a snapshot', async () => {
    const { workspace, user } = await setup()
    const site = await seedSite(workspace.id, user.id)
    await seedSitePage(site.id, { slug: 'velha', path: 'velha' })
    const restored = expectOk(
      await SiteRepository.replaceDraft(site.id, {
        theme: { a: 1 },
        settings: { seo: {} },
        homePageId: 'restored-home',
        pages: [
          pageInput({
            id: 'restored-child',
            parentId: 'restored-home',
            isHome: false,
            slug: 'sub',
            path: 'inicio/sub',
          }),
          pageInput({ id: 'restored-home' }),
        ],
        globals: [
          { id: 'g-restored', kind: 'FOOTER', name: 'Rodapé', document: doc },
        ],
        updatedById: user.id,
      }),
    )
    expect(restored.theme).toEqual({ a: 1 })
    expect(restored.homePageId).toBe('restored-home')
    const pages = await prisma.sitePage.findMany({ where: { siteId: site.id } })
    expect(pages.map((p) => p.id).sort()).toEqual([
      'restored-child',
      'restored-home',
    ])

    expectOk(
      await SiteRepository.replaceDraft(site.id, {
        theme: {},
        settings: {},
        homePageId: null,
        pages: [pageInput({ id: 'only' })],
        globals: [],
        updatedById: user.id,
      }),
    )
    expect(await prisma.siteGlobal.count({ where: { siteId: site.id } })).toBe(
      0,
    )
  })

  it('finds the site migrated from a landing page', async () => {
    const { workspace, user } = await setup()
    const landing = await seedCrmLandingPage(workspace.id, user.id)
    expect(
      expectOk(await SiteRepository.findBySourceLandingPageId(landing.id)),
    ).toBeNull()
    expect(
      expectOk(
        await SiteRepository.findPublishedSlugByLandingShareToken(
          landing.shareToken,
        ),
      ),
    ).toBeNull()
    expect(
      expectOk(
        await SiteRepository.findPublishedSlugByLandingShareToken('nope'),
      ),
    ).toBeNull()

    const site = await seedSite(workspace.id, user.id, {
      slug: 'migrada',
      sourceLandingPageId: landing.id,
      status: 'PUBLISHED',
    })
    expect(
      expectOk(await SiteRepository.findBySourceLandingPageId(landing.id))?.id,
    ).toBe(site.id)
    expect(
      expectOk(
        await SiteRepository.findPublishedSlugByLandingShareToken(
          landing.shareToken,
        ),
      ),
    ).toBe('migrada')

    const all = expectOk(
      await SiteRepository.listLandingPagesForMigration(workspace.id),
    )
    expect(all.map((l) => l.id)).toEqual([landing.id])
    expect(Array.isArray(all[0].sections)).toBe(true)
    expect(
      expectOk(await SiteRepository.listLandingPagesForMigration()).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('loads only published forms of the workspace', async () => {
    const { workspace, user } = await setup()
    const other = await seedWorkspace()
    const published = await seedCrmForm(workspace.id, user.id, {
      status: 'PUBLISHED',
    })
    const draft = await seedCrmForm(workspace.id, user.id)
    const foreign = await seedCrmForm(other.id, user.id, {
      status: 'PUBLISHED',
    })
    expect(
      expectOk(await SiteRepository.findPublishedForms(workspace.id, [])),
    ).toEqual([])
    const forms = expectOk(
      await SiteRepository.findPublishedForms(workspace.id, [
        published.id,
        draft.id,
        foreign.id,
      ]),
    )
    expect(forms.map((f) => f.id)).toEqual([published.id])
  })

  it('records an anonymous view', async () => {
    const { workspace, user } = await setup()
    const site = await seedSite(workspace.id, user.id)
    expectOk(
      await SiteRepository.recordView({
        siteId: site.id,
        pageId: null,
        path: '/',
        visitorHash: 'h',
        referrer: 'google.com',
        utmSource: 'x',
      }),
    )
    expect(await prisma.siteView.count({ where: { siteId: site.id } })).toBe(1)
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const fail = () => Promise.reject(new Error('boom'))
    const spies = [
      vi.spyOn(prisma.site, 'findMany').mockImplementation(fail as never),
      vi.spyOn(prisma.site, 'count').mockImplementation(fail as never),
      vi.spyOn(prisma.site, 'findFirst').mockImplementation(fail as never),
      vi.spyOn(prisma.site, 'findUnique').mockImplementation(fail as never),
      vi.spyOn(prisma.site, 'update').mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteVersion, 'findMany')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteVersion, 'findFirst')
        .mockImplementation(fail as never),
      vi.spyOn(prisma.crmForm, 'findMany').mockImplementation(fail as never),
      vi.spyOn(prisma.siteView, 'create').mockImplementation(fail as never),
      vi
        .spyOn(prisma.crmLandingPage, 'findFirst')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.crmLandingPage, 'findMany')
        .mockImplementation(fail as never),
      vi.spyOn(prisma, '$transaction').mockImplementation(fail as never),
    ]
    const results = await Promise.all([
      SiteRepository.listByWorkspace('w'),
      SiteRepository.countByWorkspace('w'),
      SiteRepository.findById('s', 'w'),
      SiteRepository.isSlugTaken('x'),
      SiteRepository.findBySourceLandingPageId('l'),
      SiteRepository.update('s', { updatedById: 'u' }),
      SiteRepository.softDelete('s', 'x'),
      SiteRepository.findPublishedBySlug('x'),
      SiteRepository.unpublish('s', 'u'),
      SiteRepository.listVersions('s'),
      SiteRepository.findVersion('s', 'v'),
      SiteRepository.findPublishedForms('w', ['f']),
      SiteRepository.recordView({
        siteId: 's',
        pageId: null,
        path: '',
        visitorHash: 'h',
        referrer: null,
      }),
      SiteRepository.findPublishedSlugByLandingShareToken('t'),
      SiteRepository.listLandingPagesForMigration(),
      SiteRepository.createWithPages({
        site: {
          workspaceId: 'w',
          createdById: 'u',
          name: 'x',
          slug: 'x',
          theme: {},
          settings: {},
        },
        pages: [],
        globals: [],
      }),
      SiteRepository.replaceDraft('s', {
        theme: {},
        settings: {},
        homePageId: null,
        pages: [],
        globals: [],
        updatedById: 'u',
      }),
    ])
    for (const result of results) expectErr(result, 'DATABASE_ERROR')
    for (const spy of spies) spy.mockRestore()
  })
})
