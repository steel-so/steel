import { describe, expect, it, vi } from 'vitest'
import { seedCrmProduct } from '@/src/__tests__/factories/crm-product.factory'
import { seedNewsletterScope } from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import {
  seedSite,
  seedSitePost,
} from '@/src/__tests__/factories/newsletter2-digest-ai.factory'
import { seedSdKbArticle } from '@/src/__tests__/factories/sd-kb.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmNewsletterAiRepository as Repo } from '../crm-newsletter-ai.repository'

const NOW = new Date('2026-10-28T13:00:00.000Z')

describe('CrmNewsletterAiRepository', () => {
  it('lists and reads live posts of the workspace only', async () => {
    const { workspaceId, userId } = await seedNewsletterScope()
    const other = await seedNewsletterScope()
    const site = await seedSite(workspaceId, userId)
    const foreignSite = await seedSite(other.workspaceId, other.userId)
    const live = await seedSitePost(site.id, userId, { title: 'Ao vivo' })
    const draft = await seedSitePost(site.id, userId, { status: 'DRAFT' })
    const foreign = await seedSitePost(foreignSite.id, other.userId)
    const list = expectOk(await Repo.listRecentPosts(workspaceId, NOW))
    expect(list.map((p) => p.id)).toEqual([live.id])
    expect(list[0].site.name).toBe('Site Acme')
    const found = expectOk(
      await Repo.findPosts(workspaceId, [live.id, draft.id, foreign.id], NOW),
    )
    expect(found.map((p) => p.id)).toEqual([live.id])
    expect(found[0].site.slug).toBe(site.slug)
    expect(expectOk(await Repo.findPosts(workspaceId, [], NOW))).toEqual([])
  })

  it('reads only published, portal-visible, not archived KB articles', async () => {
    const { workspaceId } = await seedNewsletterScope()
    const portal = await seedSdKbArticle(workspaceId, {
      title: 'Portal',
      status: 'PUBLISHED',
      visibility: 'PORTAL',
      plainText: 'Corpo',
    })
    const internal = await seedSdKbArticle(workspaceId, {
      status: 'PUBLISHED',
      visibility: 'INTERNAL',
    })
    const archived = await seedSdKbArticle(workspaceId, {
      status: 'PUBLISHED',
      visibility: 'PORTAL',
      archivedAt: NOW,
    })
    expect(expectOk(await Repo.listKbArticles(workspaceId))).toEqual([
      { id: portal.id, title: 'Portal' },
    ])
    expect(
      expectOk(
        await Repo.findKbArticles(workspaceId, [
          portal.id,
          internal.id,
          archived.id,
        ]),
      ),
    ).toEqual([{ id: portal.id, title: 'Portal', plainText: 'Corpo' }])
    expect(expectOk(await Repo.findKbArticles('other', [portal.id]))).toEqual(
      [],
    )
    expect(expectOk(await Repo.findKbArticles(workspaceId, []))).toEqual([])
  })

  it('reads active products of the workspace', async () => {
    const { workspaceId, userId } = await seedNewsletterScope()
    const active = await seedCrmProduct(workspaceId, userId, { name: 'Ativo' })
    const off = await seedCrmProduct(workspaceId, userId, { active: false })
    expect(expectOk(await Repo.listProducts(workspaceId))).toEqual([
      { id: active.id, name: 'Ativo' },
    ])
    const found = expectOk(
      await Repo.findProducts(workspaceId, [active.id, off.id]),
    )
    expect(found.map((p) => p.id)).toEqual([active.id])
    expect(expectOk(await Repo.findProducts(workspaceId, []))).toEqual([])
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const spies = [
      vi
        .spyOn(prisma.sitePost, 'findMany')
        .mockRejectedValueOnce(new Error('x'))
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.sdKbArticle, 'findMany')
        .mockRejectedValueOnce(new Error('x'))
        .mockRejectedValueOnce(new Error('x')),
      vi
        .spyOn(prisma.crmProduct, 'findMany')
        .mockRejectedValueOnce(new Error('x'))
        .mockRejectedValueOnce(new Error('x')),
    ]
    expectErr(await Repo.listRecentPosts('w', NOW), 'DATABASE_ERROR')
    expectErr(await Repo.findPosts('w', ['p'], NOW), 'DATABASE_ERROR')
    expectErr(await Repo.listKbArticles('w'), 'DATABASE_ERROR')
    expectErr(await Repo.findKbArticles('w', ['k']), 'DATABASE_ERROR')
    expectErr(await Repo.listProducts('w'), 'DATABASE_ERROR')
    expectErr(await Repo.findProducts('w', ['p']), 'DATABASE_ERROR')
    for (const spy of spies) spy.mockRestore()
  })
})
