import { describe, expect, it, vi } from 'vitest'
import { seedSite } from '@/src/__tests__/factories/site.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SiteRedirectRepository } from '../site-redirect.repository'

describe('SiteRedirectRepository', () => {
  it('creates, lists, updates and deletes redirects', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const site = await seedSite(workspace.id, user.id, { slug: 'redir-site' })
    const other = await seedSite(workspace.id, user.id)

    const b = expectOk(
      await SiteRedirectRepository.create({
        siteId: site.id,
        fromPath: '/b',
        toPath: '/c',
        permanent: true,
      }),
    )
    const a = expectOk(
      await SiteRedirectRepository.create({
        siteId: site.id,
        fromPath: '/a',
        toPath: 'https://x.com',
        permanent: false,
      }),
    )
    // Same source on another site is fine; on the same site it is taken.
    expectOk(
      await SiteRedirectRepository.create({
        siteId: other.id,
        fromPath: '/a',
        toPath: '/z',
        permanent: true,
      }),
    )
    expectErr(
      await SiteRedirectRepository.create({
        siteId: site.id,
        fromPath: '/a',
        toPath: '/y',
        permanent: true,
      }),
      'SITE_REDIRECT_PATH_TAKEN',
    )

    expect(
      expectOk(await SiteRedirectRepository.listBySite(site.id)).map(
        (r) => r.fromPath,
      ),
    ).toEqual(['/a', '/b'])
    expect(
      expectOk(await SiteRedirectRepository.listBySiteSlug('redir-site')),
    ).toHaveLength(2)
    expect(expectOk(await SiteRedirectRepository.count(site.id))).toBe(2)
    expect(
      expectOk(await SiteRedirectRepository.findById(a.id, site.id)).toPath,
    ).toBe('https://x.com')
    expectErr(
      await SiteRedirectRepository.findById(a.id, other.id),
      'SITE_REDIRECT_NOT_FOUND',
    )

    expect(
      expectOk(await SiteRedirectRepository.update(b.id, { toPath: '/d' }))
        .toPath,
    ).toBe('/d')
    expectErr(
      await SiteRedirectRepository.update(b.id, { fromPath: '/a' }),
      'SITE_REDIRECT_PATH_TAKEN',
    )
    expectOk(await SiteRedirectRepository.delete(b.id))
    expect(expectOk(await SiteRedirectRepository.count(site.id))).toBe(1)

    // A deleted site serves no redirects.
    await prisma.site.update({
      where: { id: site.id },
      data: { deletedAt: new Date() },
    })
    expect(
      expectOk(await SiteRedirectRepository.listBySiteSlug('redir-site')),
    ).toEqual([])
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const fail = () => Promise.reject(new Error('boom'))
    const spies = [
      vi
        .spyOn(prisma.siteRedirect, 'findMany')
        .mockImplementation(fail as never),
      vi
        .spyOn(prisma.siteRedirect, 'findFirst')
        .mockImplementation(fail as never),
      vi.spyOn(prisma.siteRedirect, 'count').mockImplementation(fail as never),
      vi.spyOn(prisma.siteRedirect, 'create').mockImplementation(fail as never),
      vi.spyOn(prisma.siteRedirect, 'update').mockImplementation(fail as never),
      vi.spyOn(prisma.siteRedirect, 'delete').mockImplementation(fail as never),
    ]
    const results = await Promise.all([
      SiteRedirectRepository.listBySite('s'),
      SiteRedirectRepository.listBySiteSlug('s'),
      SiteRedirectRepository.findById('r', 's'),
      SiteRedirectRepository.count('s'),
      SiteRedirectRepository.create({
        siteId: 's',
        fromPath: '/a',
        toPath: '/b',
        permanent: true,
      }),
      SiteRedirectRepository.update('r', { toPath: '/b' }),
      SiteRedirectRepository.delete('r'),
    ])
    for (const result of results) expectErr(result, 'DATABASE_ERROR')
    for (const spy of spies) spy.mockRestore()
  })
})
