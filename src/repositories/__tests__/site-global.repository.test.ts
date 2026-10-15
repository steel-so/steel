import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import {
  createSiteDocument,
  seedSite,
  seedSiteGlobal,
} from '@/src/__tests__/factories/site.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SiteGlobalRepository } from '../site-global.repository'

const doc = createSiteDocument() as unknown as Prisma.InputJsonValue

describe('SiteGlobalRepository', () => {
  it('creates, counts, lists, updates and deletes globals', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const site = await seedSite(workspace.id, user.id)
    const symbol = await seedSiteGlobal(site.id, {
      kind: 'SYMBOL',
      name: 'CTA',
    })
    const header = expectOk(
      await SiteGlobalRepository.create({
        siteId: site.id,
        kind: 'HEADER',
        name: 'Topo',
        document: doc,
      }),
    )

    expect(
      expectOk(await SiteGlobalRepository.listBySite(site.id)).map(
        (g) => g.kind,
      ),
    ).toEqual(['HEADER', 'SYMBOL'])
    expect(expectOk(await SiteGlobalRepository.countByKind(site.id))).toBe(2)
    expect(
      expectOk(await SiteGlobalRepository.countByKind(site.id, 'FOOTER')),
    ).toBe(0)
    expect(
      expectOk(await SiteGlobalRepository.findById(symbol.id, site.id)).name,
    ).toBe('CTA')
    expectErr(
      await SiteGlobalRepository.findById(symbol.id, 'other'),
      'SITE_GLOBAL_NOT_FOUND',
    )

    expect(
      expectOk(await SiteGlobalRepository.update(header.id, { name: 'Novo' }))
        .name,
    ).toBe('Novo')
    expectOk(await SiteGlobalRepository.delete(header.id))
    expect(expectOk(await SiteGlobalRepository.countByKind(site.id))).toBe(1)
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const fail = () => Promise.reject(new Error('boom'))
    const spies = [
      vi.spyOn(prisma.siteGlobal, 'findMany').mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteGlobal, 'findFirst')
        .mockImplementation(fail as never),
      vi.spyOn(prisma.siteGlobal, 'count').mockImplementation(fail as never),
      vi.spyOn(prisma.siteGlobal, 'create').mockImplementation(fail as never),
      vi.spyOn(prisma.siteGlobal, 'update').mockImplementation(fail as never),
      vi.spyOn(prisma.siteGlobal, 'delete').mockImplementation(fail as never),
    ]
    const results = await Promise.all([
      SiteGlobalRepository.listBySite('s'),
      SiteGlobalRepository.findById('g', 's'),
      SiteGlobalRepository.countByKind('s'),
      SiteGlobalRepository.create({
        siteId: 's',
        kind: 'SYMBOL',
        name: 'x',
        document: doc,
      }),
      SiteGlobalRepository.update('g', { name: 'x' }),
      SiteGlobalRepository.delete('g'),
    ])
    for (const result of results) expectErr(result, 'DATABASE_ERROR')
    for (const spy of spies) spy.mockRestore()
  })
})
