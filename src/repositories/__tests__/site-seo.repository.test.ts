import { describe, expect, it, vi } from 'vitest'
import { seedSite, seedSitePage } from '@/src/__tests__/factories/site.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SiteSeoRepository } from '../site-seo.repository'

const day = (value: string) => new Date(`${value}T00:00:00Z`)

describe('SiteSeoRepository', () => {
  it('creates, counts, lists and deletes keywords per site', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const site = await seedSite(workspace.id, user.id)
    const other = await seedSite(workspace.id, user.id)

    const first = expectOk(
      await SiteSeoRepository.createKeyword({
        siteId: site.id,
        term: 'Clínica Odontológica',
        normalized: 'clinica odontologica',
        createdById: user.id,
      }),
    )
    // Same normalized term on another site is fine; on the same site it is a duplicate.
    expectOk(
      await SiteSeoRepository.createKeyword({
        siteId: other.id,
        term: 'clinica odontologica',
        normalized: 'clinica odontologica',
        createdById: user.id,
      }),
    )
    expectErr(
      await SiteSeoRepository.createKeyword({
        siteId: site.id,
        term: 'CLINICA ODONTOLOGICA',
        normalized: 'clinica odontologica',
        createdById: user.id,
      }),
      'SEO_KEYWORD_DUPLICATE',
    )

    expect(expectOk(await SiteSeoRepository.countKeywords(site.id))).toBe(1)
    expect(
      expectOk(await SiteSeoRepository.listKeywords(site.id)).map(
        (item) => item.term,
      ),
    ).toEqual(['Clínica Odontológica'])

    expectErr(
      await SiteSeoRepository.deleteKeyword(first.id, other.id),
      'SEO_KEYWORD_NOT_FOUND',
    )
    expectOk(await SiteSeoRepository.deleteKeyword(first.id, site.id))
    expect(expectOk(await SiteSeoRepository.countKeywords(site.id))).toBe(0)
  })

  it('keeps one snapshot per site and day, lists by window and prunes', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const site = await seedSite(workspace.id, user.id)
    const base = {
      siteId: site.id,
      seo: 50,
      aeo: 40,
      geo: 30,
      pages: 2,
      issues: 9,
    }

    expectOk(
      await SiteSeoRepository.upsertSnapshot({
        ...base,
        day: day('2026-11-17'),
      }),
    )
    expectOk(
      await SiteSeoRepository.upsertSnapshot({
        ...base,
        day: day('2026-11-18'),
      }),
    )
    // A later run of the same day overwrites it.
    expectOk(
      await SiteSeoRepository.upsertSnapshot({
        ...base,
        seo: 80,
        day: day('2026-11-18'),
      }),
    )

    const all = expectOk(
      await SiteSeoRepository.listSnapshots([site.id], day('2026-11-01')),
    )
    expect(all.map((item) => item.seo)).toEqual([50, 80])
    expect(
      expectOk(
        await SiteSeoRepository.listSnapshots([site.id], day('2026-11-18')),
      ),
    ).toHaveLength(1)

    expect(
      expectOk(await SiteSeoRepository.pruneSnapshots(day('2026-11-18'))),
    ).toBe(1)
    expect(
      expectOk(
        await SiteSeoRepository.listSnapshots([site.id], day('2026-01-01')),
      ),
    ).toHaveLength(1)
  })

  it('lists only live sites that have pages for the daily snapshot', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const withPages = await seedSite(workspace.id, user.id)
    await seedSitePage(withPages.id)
    await seedSite(workspace.id, user.id)
    const deleted = await seedSite(workspace.id, user.id, {
      deletedAt: new Date(),
    })
    await seedSitePage(deleted.id)

    const ids = expectOk(await SiteSeoRepository.listSiteIdsForSnapshot())
    expect(ids).toEqual([{ id: withPages.id, workspaceId: workspace.id }])
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const fail = () => Promise.reject(new Error('boom'))
    const spies = [
      vi
        .spyOn(prisma.siteSeoKeyword, 'findMany')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteSeoKeyword, 'count')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteSeoKeyword, 'create')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteSeoKeyword, 'deleteMany')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteSeoSnapshot, 'findMany')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteSeoSnapshot, 'upsert')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteSeoSnapshot, 'deleteMany')
        .mockImplementation(fail as never),
      vi.spyOn(prisma.site, 'findMany').mockImplementation(fail as never),
    ]
    const results = await Promise.all([
      SiteSeoRepository.listKeywords('s'),
      SiteSeoRepository.countKeywords('s'),
      SiteSeoRepository.createKeyword({
        siteId: 's',
        term: 'a',
        normalized: 'a',
        createdById: 'u',
      }),
      SiteSeoRepository.deleteKeyword('k', 's'),
      SiteSeoRepository.listSnapshots(['s'], new Date()),
      SiteSeoRepository.upsertSnapshot({
        siteId: 's',
        day: new Date(),
        seo: 1,
        aeo: 1,
        geo: 1,
        pages: 1,
        issues: 1,
      }),
      SiteSeoRepository.pruneSnapshots(new Date()),
      SiteSeoRepository.listSiteIdsForSnapshot(),
    ])
    for (const result of results) expectErr(result, 'DATABASE_ERROR')
    for (const spy of spies) spy.mockRestore()
  })
})
