import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmLandingPage,
  createFakeCrmLandingPageSection,
} from '@/src/__tests__/factories/crm-landing-page.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSite,
  createFakeSiteVersion,
} from '@/src/__tests__/factories/site.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/site-page.repository')
vi.mock('@/src/repositories/site-global.repository')
vi.mock('@/src/lib/sites/cache')
vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import { SiteLandingMigrationService } from '../site-landing-migration.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const pages = vi.mocked(SitePageRepository)
const globals = vi.mocked(SiteGlobalRepository)
const audit = vi.mocked(auditMutation)

function landing(
  overrides: Parameters<typeof createFakeCrmLandingPage>[0] = {},
  withChrome = true,
) {
  const page = createFakeCrmLandingPage({ title: 'Clínica', ...overrides })
  const section = (type: string, order: number, content: object) =>
    createFakeCrmLandingPageSection({
      landingPageId: page.id,
      type: type as never,
      order,
      content: { type, ...content } as never,
    })
  return {
    ...page,
    sections: [
      ...(withChrome ? [section('HEADER', 0, { logoText: 'Clínica' })] : []),
      section('HERO', 1, { title: 'Olá' }),
      ...(withChrome ? [section('FOOTER', 2, {})] : []),
    ],
  }
}

const created = createFakeSite({ id: 'site1', slug: 'clinica' })

beforeEach(() => {
  sites.findBySourceLandingPageId.mockResolvedValue(ok(null))
  sites.isSlugTaken.mockResolvedValue(ok(false))
  sites.createWithPages.mockResolvedValue(ok(created))
  pages.listWithDocuments.mockImplementation(async () => {
    const input = sites.createWithPages.mock.calls.at(-1)?.[0]
    return ok(
      (input?.pages ?? []).map((page, index) => ({
        ...page,
        id: `p${index}`,
        siteId: created.id,
        document: page.document as never,
        seo: page.seo as never,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    )
  })
  globals.listBySite.mockResolvedValue(ok([]))
  sites.publish.mockResolvedValue(
    ok({ site: created, version: createFakeSiteVersion() }),
  )
})

describe('SiteLandingMigrationService.migrateLandingPage', () => {
  it('creates a draft site with header and footer globals', async () => {
    const source = landing()
    const result = expectOk(
      await SiteLandingMigrationService.migrateLandingPage(source),
    )
    expect(result).toEqual({
      landingPageId: source.id,
      siteId: 'site1',
      slug: 'clinica',
      status: 'created',
      published: false,
    })
    const input = sites.createWithPages.mock.calls[0][0]
    expect(input.site).toMatchObject({
      name: 'Clínica',
      slug: 'clinica',
      sourceLandingPageId: source.id,
      workspaceId: source.workspaceId,
      createdById: source.createdById,
    })
    expect(input.globals.map((g) => g.kind)).toEqual(['HEADER', 'FOOTER'])
    expect(input.pages[0]).toMatchObject({ isHome: true, title: 'Clínica' })
    expect(sites.publish).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'migrate', actorId: null }),
    )
  })

  it('publishes a published landing page as version 1', async () => {
    const result = expectOk(
      await SiteLandingMigrationService.migrateLandingPage(
        landing({ status: 'PUBLISHED' }, false),
      ),
    )
    expect(result.published).toBe(true)
    expect(sites.createWithPages.mock.calls[0][0].globals).toEqual([])
    expect(sites.publish).toHaveBeenCalledTimes(1)
  })

  it('keeps the site as a draft when publishing fails', async () => {
    sites.publish.mockResolvedValueOnce(err(databaseError()))
    const result = expectOk(
      await SiteLandingMigrationService.migrateLandingPage(
        landing({ status: 'PUBLISHED' }),
      ),
    )
    expect(result).toMatchObject({ status: 'created', published: false })
    expect(logger.warn).toHaveBeenCalledWith(
      'sites.migration.publish_failed',
      expect.objectContaining({ code: 'DATABASE_ERROR' }),
    )

    pages.listWithDocuments.mockResolvedValueOnce(err(databaseError()))
    expect(
      expectOk(
        await SiteLandingMigrationService.migrateLandingPage(
          landing({ status: 'PUBLISHED' }),
        ),
      ).published,
    ).toBe(false)
  })

  it('links newsletter forms by their public token', async () => {
    const source = landing()
    source.sections.push(
      createFakeCrmLandingPageSection({
        landingPageId: source.id,
        type: 'NEWSLETTER',
        order: 5,
        content: { type: 'NEWSLETTER', title: 'A', formId: 'f1' } as never,
      }),
      createFakeCrmLandingPageSection({
        landingPageId: source.id,
        type: 'NEWSLETTER',
        order: 6,
        content: { type: 'NEWSLETTER', title: 'B', formId: 'gone' } as never,
      }),
    )
    sites.findFormsByIds.mockResolvedValueOnce(
      ok([{ id: 'f1', name: 'Contato', publicToken: 'tok-1' }]),
    )
    expectOk(await SiteLandingMigrationService.migrateLandingPage(source))
    expect(sites.findFormsByIds).toHaveBeenCalledWith(source.workspaceId, [
      'f1',
      'gone',
    ])
    const doc = sites.createWithPages.mock.calls[0][0].pages[0]
      .document as unknown as {
      nodes: Record<string, { type: string; props: unknown }>
    }
    const forms = Object.values(doc.nodes)
      .filter((node) => node.type === 'site.form')
      .map((node) => node.props)
    expect(forms).toEqual([
      expect.objectContaining({ formToken: 'tok-1', formName: 'Contato' }),
      expect.objectContaining({ formToken: '', formName: '' }),
    ])
    expect(forms[0]).not.toHaveProperty('formId')

    sites.findFormsByIds.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteLandingMigrationService.migrateLandingPage(source),
      'DATABASE_ERROR',
    )
  })

  it('skips landing pages that already have a site', async () => {
    sites.findBySourceLandingPageId.mockResolvedValue(
      ok(createFakeSite({ id: 's9', slug: 'antigo', status: 'PUBLISHED' })),
    )
    const result = expectOk(
      await SiteLandingMigrationService.migrateLandingPage(landing()),
    )
    expect(result).toMatchObject({
      siteId: 's9',
      status: 'skipped',
      published: true,
    })
    expect(sites.createWithPages).not.toHaveBeenCalled()
  })

  it('propagates lookup, slug and insert failures', async () => {
    sites.findBySourceLandingPageId.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteLandingMigrationService.migrateLandingPage(landing()),
      'DATABASE_ERROR',
    )
    sites.isSlugTaken.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteLandingMigrationService.migrateLandingPage(landing()),
      'DATABASE_ERROR',
    )
    sites.createWithPages.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteLandingMigrationService.migrateLandingPage(landing()),
      'DATABASE_ERROR',
    )
  })
})

describe('SiteLandingMigrationService.migrateAll', () => {
  it('reports created, skipped and failed pages', async () => {
    sites.listLandingPagesForMigration.mockResolvedValue(
      ok([landing(), landing(), landing()]),
    )
    sites.findBySourceLandingPageId
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(createFakeSite()))
      .mockResolvedValueOnce(err(databaseError()))
    const report = expectOk(await SiteLandingMigrationService.migrateAll('ws1'))
    expect(report).toMatchObject({ created: 1, skipped: 1, failed: 1 })
    expect(report.items).toHaveLength(2)
    expect(sites.listLandingPagesForMigration).toHaveBeenCalledWith('ws1')
    expect(logger.error).toHaveBeenCalledWith(
      'sites.migration.failed',
      expect.objectContaining({ code: 'DATABASE_ERROR' }),
    )
  })

  it('propagates the listing failure', async () => {
    sites.listLandingPagesForMigration.mockResolvedValue(err(databaseError()))
    expectErr(await SiteLandingMigrationService.migrateAll(), 'DATABASE_ERROR')
  })
})

describe('SiteLandingMigrationService.migrateWorkspace', () => {
  it('is restricted to workspace admins', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'MEMBER' })),
    )
    expectErr(
      await SiteLandingMigrationService.migrateWorkspace('u1', 'ws1'),
      'FORBIDDEN',
    )
  })

  it('migrates the workspace and audits the run', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'ADMIN' })),
    )
    sites.listLandingPagesForMigration.mockResolvedValue(ok([landing()]))
    const report = expectOk(
      await SiteLandingMigrationService.migrateWorkspace('u1', 'ws1'),
    )
    expect(report.created).toBe(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'migrate',
        actorId: 'u1',
        targetId: 'ws1',
      }),
    )
    sites.listLandingPagesForMigration.mockResolvedValue(err(databaseError()))
    expectErr(
      await SiteLandingMigrationService.migrateWorkspace('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })
})
