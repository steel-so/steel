import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWikiPage } from '@/src/__tests__/factories/wiki-page.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WikiPageFavoriteRepository } from '../wiki-page-favorite.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WikiPageFavoriteRepository', () => {
  it('should add idempotently, read and remove a favorite', async () => {
    const workspace = await seedWorkspace()
    const user = await seedUser()
    const page = await seedWikiPage(workspace.id, user.id)

    expectOk(await WikiPageFavoriteRepository.add(user.id, page.id))
    expectOk(await WikiPageFavoriteRepository.add(user.id, page.id))
    expect(
      expectOk(await WikiPageFavoriteRepository.isFavorite(user.id, page.id)),
    ).toBe(true)
    expect(await prisma.wikiPageFavorite.count()).toBe(1)

    expectOk(await WikiPageFavoriteRepository.remove(user.id, page.id))
    expectOk(await WikiPageFavoriteRepository.remove(user.id, page.id))
    expect(
      expectOk(await WikiPageFavoriteRepository.isFavorite(user.id, page.id)),
    ).toBe(false)
  })

  it('should list only the user favorites of the workspace', async () => {
    const workspace = await seedWorkspace()
    const otherWorkspace = await seedWorkspace()
    const user = await seedUser()
    const other = await seedUser()
    const mine = await seedWikiPage(workspace.id, user.id)
    const notMine = await seedWikiPage(workspace.id, user.id)
    const elsewhere = await seedWikiPage(otherWorkspace.id, user.id)
    await WikiPageFavoriteRepository.add(user.id, mine.id)
    await WikiPageFavoriteRepository.add(other.id, notMine.id)
    await WikiPageFavoriteRepository.add(user.id, elsewhere.id)

    const ids = expectOk(
      await WikiPageFavoriteRepository.listPageIds(user.id, workspace.id),
    )

    expect([...ids]).toEqual([mine.id])
  })

  it('should cascade when the page is deleted', async () => {
    const workspace = await seedWorkspace()
    const user = await seedUser()
    const page = await seedWikiPage(workspace.id, user.id)
    await WikiPageFavoriteRepository.add(user.id, page.id)

    await prisma.wikiPage.delete({ where: { id: page.id } })

    expect(await prisma.wikiPageFavorite.count()).toBe(0)
  })

  it('should return DATABASE_ERROR when queries fail', async () => {
    expectErr(
      await WikiPageFavoriteRepository.add('missing-user', 'missing-page'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.wikiPageFavorite, 'deleteMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WikiPageFavoriteRepository.remove('u', 'p'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.wikiPageFavorite, 'findUnique').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WikiPageFavoriteRepository.isFavorite('u', 'p'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.wikiPageFavorite, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WikiPageFavoriteRepository.listPageIds('u', 'w'),
      'DATABASE_ERROR',
    )
  })
})
