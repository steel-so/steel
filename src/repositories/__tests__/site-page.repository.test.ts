import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import {
  createSiteDocument,
  seedSite,
  seedSitePage,
} from '@/src/__tests__/factories/site.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SitePageRepository } from '../site-page.repository'

const doc = createSiteDocument() as unknown as Prisma.InputJsonValue

async function siteFixture() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  return seedSite(workspace.id, user.id)
}

describe('SitePageRepository', () => {
  it('creates pages at the end and lists them in order without documents', async () => {
    const site = await siteFixture()
    const a = expectOk(
      await SitePageRepository.create({
        siteId: site.id,
        parentId: null,
        title: 'A',
        slug: 'a',
        path: 'a',
        document: doc,
        seo: {},
      }),
    )
    const b = await seedSitePage(site.id, { slug: 'b', position: 5 })
    expect(a.position).toBe(0)

    const list = expectOk(await SitePageRepository.listBySite(site.id))
    expect(list.map((p) => p.id)).toEqual([a.id, b.id])
    expect(list[0]).not.toHaveProperty('document')
    const full = expectOk(await SitePageRepository.listWithDocuments(site.id))
    expect(full[0].document).toEqual(createSiteDocument())
    expect(expectOk(await SitePageRepository.count(site.id))).toBe(2)
    expect(
      expectOk(await SitePageRepository.findById(a.id, site.id)).title,
    ).toBe('A')
    expectErr(
      await SitePageRepository.findById(a.id, 'other'),
      'SITE_PAGE_NOT_FOUND',
    )
  })

  it('maps path collisions on create and update', async () => {
    const site = await siteFixture()
    await seedSitePage(site.id, { slug: 'contato', path: 'contato' })
    const other = await seedSitePage(site.id, { slug: 'sobre', path: 'sobre' })
    expect(
      expectOk(await SitePageRepository.isPathTaken(site.id, 'contato')),
    ).toBe(true)
    expect(
      expectOk(
        await SitePageRepository.isPathTaken(site.id, 'sobre', other.id),
      ),
    ).toBe(false)
    expectErr(
      await SitePageRepository.create({
        siteId: site.id,
        parentId: null,
        title: 'x',
        slug: 'contato',
        path: 'contato',
        document: doc,
        seo: {},
      }),
      'SITE_PAGE_PATH_TAKEN',
    )
    expectErr(
      await SitePageRepository.update(other.id, {
        slug: 'contato',
        path: 'contato',
      }),
      'SITE_PAGE_PATH_TAKEN',
    )
  })

  it('updates a page with its subtree paths in one transaction', async () => {
    const site = await siteFixture()
    const parent = await seedSitePage(site.id, {
      slug: 'servicos',
      path: 'servicos',
    })
    const child = await seedSitePage(site.id, {
      slug: 'web',
      path: 'servicos/web',
      parentId: parent.id,
    })
    const updated = expectOk(
      await SitePageRepository.update(
        parent.id,
        { slug: 'solucoes', path: 'solucoes', title: 'Soluções' },
        [{ id: child.id, path: 'solucoes/web' }],
      ),
    )
    expect(updated.path).toBe('solucoes')
    expect(
      (await prisma.sitePage.findUniqueOrThrow({ where: { id: child.id } }))
        .path,
    ).toBe('solucoes/web')
  })

  it('reorders, sets the home page and deletes', async () => {
    const site = await siteFixture()
    const a = await seedSitePage(site.id, { isHome: true })
    const b = await seedSitePage(site.id)
    expectOk(await SitePageRepository.reorder(site.id, [b.id, a.id]))
    expect(
      expectOk(await SitePageRepository.listBySite(site.id)).map((p) => p.id),
    ).toEqual([b.id, a.id])

    expectOk(await SitePageRepository.setHome(site.id, b.id))
    const pages = await prisma.sitePage.findMany({ where: { siteId: site.id } })
    expect(pages.filter((p) => p.isHome).map((p) => p.id)).toEqual([b.id])
    expect(
      (await prisma.site.findUniqueOrThrow({ where: { id: site.id } }))
        .homePageId,
    ).toBe(b.id)

    expectOk(await SitePageRepository.delete(a.id))
    expect(expectOk(await SitePageRepository.count(site.id))).toBe(1)
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const fail = () => Promise.reject(new Error('boom'))
    const spies = [
      vi.spyOn(prisma.sitePage, 'findMany').mockImplementation(fail as never),
      vi.spyOn(prisma.sitePage, 'count').mockImplementation(fail as never),
      vi.spyOn(prisma.sitePage, 'findFirst').mockImplementation(fail as never),
      vi.spyOn(prisma.sitePage, 'findUnique').mockImplementation(fail as never),
      vi.spyOn(prisma.sitePage, 'delete').mockImplementation(fail as never),
      vi.spyOn(prisma, '$transaction').mockImplementation(fail as never),
    ]
    const results = await Promise.all([
      SitePageRepository.listBySite('s'),
      SitePageRepository.listWithDocuments('s'),
      SitePageRepository.count('s'),
      SitePageRepository.findById('p', 's'),
      SitePageRepository.isPathTaken('s', 'x'),
      SitePageRepository.create({
        siteId: 's',
        parentId: null,
        title: 'x',
        slug: 'x',
        path: 'x',
        document: doc,
        seo: {},
      }),
      SitePageRepository.update('p', { title: 'x' }),
      SitePageRepository.delete('p'),
      SitePageRepository.reorder('s', ['p']),
      SitePageRepository.setHome('s', 'p'),
    ])
    for (const result of results) expectErr(result, 'DATABASE_ERROR')
    for (const spy of spies) spy.mockRestore()
  })
})
