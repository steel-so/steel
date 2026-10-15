import { describe, expect, it, vi } from 'vitest'
import { seedSite } from '@/src/__tests__/factories/site.factory'
import { seedSitePost } from '@/src/__tests__/factories/site-blog.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SiteAuthorRepository as Authors } from '../site-author.repository'
import { SiteBlogTermRepository as Terms } from '../site-blog-term.repository'
import { SiteCollectionRepository as Collections } from '../site-collection.repository'

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const site = await seedSite(workspace.id, user.id)
  const other = await seedSite(workspace.id, user.id)
  return { user, site, other }
}

const down = () => Promise.reject(new Error('down'))

describe('SiteBlogTermRepository', () => {
  it('manages categories', async () => {
    const { user, site, other } = await setup()
    const dicas = expectOk(
      await Terms.createCategory({
        siteId: site.id,
        name: 'Dicas',
        slug: 'dicas',
        position: 1,
      }),
    )
    expectOk(
      await Terms.createCategory({
        siteId: site.id,
        name: 'Antes',
        slug: 'antes',
        position: 0,
      }),
    )
    expectErr(
      await Terms.createCategory({
        siteId: site.id,
        name: 'X',
        slug: 'dicas',
        position: 2,
      }),
      'SITE_BLOG_TERM_SLUG_TAKEN',
    )
    const post = await seedSitePost(site.id, user.id)
    await prisma.sitePostCategory.create({
      data: { postId: post.id, categoryId: dicas.id },
    })
    const list = expectOk(await Terms.listCategories(site.id))
    expect(list.map((c) => [c.slug, c._count.posts])).toEqual([
      ['antes', 0],
      ['dicas', 1],
    ])
    expect(expectOk(await Terms.findCategory(dicas.id, site.id)).name).toBe(
      'Dicas',
    )
    expectErr(
      await Terms.findCategory(dicas.id, other.id),
      'SITE_BLOG_TERM_NOT_FOUND',
    )
    expect(expectOk(await Terms.findCategoryBySlug(site.id, 'dicas'))?.id).toBe(
      dicas.id,
    )
    expect(
      expectOk(await Terms.findCategoryBySlug(other.id, 'dicas')),
    ).toBeNull()
    expect(expectOk(await Terms.countCategories(site.id))).toBe(2)
    expect(
      expectOk(await Terms.updateCategory(dicas.id, { name: 'Dicas 2' })).name,
    ).toBe('Dicas 2')
    expectErr(
      await Terms.updateCategory(dicas.id, { slug: 'antes' }),
      'SITE_BLOG_TERM_SLUG_TAKEN',
    )
    expectErr(
      await Terms.updateCategory('nope', { name: 'x' }),
      'DATABASE_ERROR',
    )
    expectOk(await Terms.deleteCategory(dicas.id))
    expectErr(await Terms.deleteCategory(dicas.id), 'DATABASE_ERROR')
  })

  it('manages tags and ownership counts', async () => {
    const { site, other } = await setup()
    const seo = expectOk(
      await Terms.createTag({ siteId: site.id, name: 'seo', slug: 'seo' }),
    )
    expectErr(
      await Terms.createTag({ siteId: site.id, name: 'S', slug: 'seo' }),
      'SITE_BLOG_TERM_SLUG_TAKEN',
    )
    const upserted = expectOk(
      await Terms.upsertTags(site.id, [
        { name: 'seo', slug: 'seo' },
        { name: 'Novo', slug: 'novo' },
      ]),
    )
    expect(upserted.map((t) => t.slug)).toEqual(['seo', 'novo'])
    expect(upserted[0].id).toBe(seo.id)
    expect(expectOk(await Terms.listTags(site.id)).map((t) => t.slug)).toEqual([
      'novo',
      'seo',
    ])
    expect(expectOk(await Terms.findTag(seo.id, site.id)).slug).toBe('seo')
    expectErr(await Terms.findTag(seo.id, other.id), 'SITE_BLOG_TERM_NOT_FOUND')
    expect(expectOk(await Terms.countTags(site.id))).toBe(2)
    expect(expectOk(await Terms.updateTag(seo.id, { name: 'SEO' })).name).toBe(
      'SEO',
    )
    expectErr(
      await Terms.updateTag(seo.id, { slug: 'novo' }),
      'SITE_BLOG_TERM_SLUG_TAKEN',
    )
    expectErr(await Terms.updateTag('nope', { name: 'x' }), 'DATABASE_ERROR')
    const category = expectOk(
      await Terms.createCategory({
        siteId: site.id,
        name: 'C',
        slug: 'c',
        position: 0,
      }),
    )
    expect(
      expectOk(await Terms.countOwned(site.id, [category.id, 'x'], [seo.id])),
    ).toEqual({ categories: 1, tags: 1 })
    expect(
      expectOk(await Terms.countOwned(other.id, [category.id], [seo.id])),
    ).toEqual({ categories: 0, tags: 0 })
    expectOk(await Terms.deleteTag(seo.id))
    expectErr(await Terms.deleteTag(seo.id), 'DATABASE_ERROR')
  })

  it('maps database failures', async () => {
    const restore = [
      vi
        .spyOn(prisma.siteBlogCategory, 'findMany')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.siteBlogCategory, 'findFirst')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.siteBlogCategory, 'count')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.siteBlogCategory, 'create')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.siteBlogTag, 'findMany')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.siteBlogTag, 'findFirst')
        .mockImplementation(down as never),
      vi.spyOn(prisma.siteBlogTag, 'count').mockImplementation(down as never),
      vi.spyOn(prisma.siteBlogTag, 'create').mockImplementation(down as never),
      vi.spyOn(prisma, '$transaction').mockImplementation(down as never),
    ]
    expectErr(await Terms.listCategories('s'), 'DATABASE_ERROR')
    expectErr(await Terms.findCategory('a', 's'), 'DATABASE_ERROR')
    expectErr(await Terms.findCategoryBySlug('s', 'a'), 'DATABASE_ERROR')
    expectErr(await Terms.countCategories('s'), 'DATABASE_ERROR')
    expectErr(
      await Terms.createCategory({
        siteId: 's',
        name: 'a',
        slug: 'a',
        position: 0,
      }),
      'DATABASE_ERROR',
    )
    expectErr(await Terms.listTags('s'), 'DATABASE_ERROR')
    expectErr(await Terms.findTag('a', 's'), 'DATABASE_ERROR')
    expectErr(await Terms.countTags('s'), 'DATABASE_ERROR')
    expectErr(
      await Terms.createTag({ siteId: 's', name: 'a', slug: 'a' }),
      'DATABASE_ERROR',
    )
    expectErr(
      await Terms.upsertTags('s', [{ name: 'a', slug: 'a' }]),
      'DATABASE_ERROR',
    )
    expectErr(await Terms.countOwned('s', [], []), 'DATABASE_ERROR')
    for (const spy of restore) spy.mockRestore()
  })
})

describe('SiteAuthorRepository', () => {
  it('manages authors', async () => {
    const { user, site, other } = await setup()
    const ana = expectOk(
      await Authors.create({
        siteId: site.id,
        userId: user.id,
        name: 'Ana',
        slug: 'ana',
        links: [],
      }),
    )
    expectErr(
      await Authors.create({ siteId: site.id, name: 'Ana 2', slug: 'ana' }),
      'SITE_AUTHOR_TAKEN',
    )
    expectErr(
      await Authors.create({
        siteId: site.id,
        userId: user.id,
        name: 'X',
        slug: 'x',
      }),
      'SITE_AUTHOR_TAKEN',
    )
    expectOk(
      await Authors.create({ siteId: site.id, name: 'Bia', slug: 'ana-2' }),
    )
    expect(expectOk(await Authors.list(site.id)).map((a) => a.name)).toEqual([
      'Ana',
      'Bia',
    ])
    expect(expectOk(await Authors.findById(ana.id, site.id)).slug).toBe('ana')
    expectErr(await Authors.findById(ana.id, other.id), 'SITE_AUTHOR_NOT_FOUND')
    expect(expectOk(await Authors.findByUser(site.id, user.id))?.id).toBe(
      ana.id,
    )
    expect(expectOk(await Authors.slugsLike(site.id, 'ana')).sort()).toEqual([
      'ana',
      'ana-2',
    ])
    expect(expectOk(await Authors.count(site.id))).toBe(2)
    expect(expectOk(await Authors.update(ana.id, { bio: 'Bio' })).bio).toBe(
      'Bio',
    )
    expectErr(
      await Authors.update(ana.id, { slug: 'ana-2' }),
      'SITE_AUTHOR_TAKEN',
    )
    expectErr(await Authors.update('nope', { bio: 'x' }), 'DATABASE_ERROR')
    expectOk(await Authors.delete(ana.id))
    expectErr(await Authors.delete(ana.id), 'DATABASE_ERROR')
  })

  it('maps database failures', async () => {
    const restore = [
      vi.spyOn(prisma.siteAuthor, 'findMany').mockImplementation(down as never),
      vi
        .spyOn(prisma.siteAuthor, 'findFirst')
        .mockImplementation(down as never),
      vi.spyOn(prisma.siteAuthor, 'count').mockImplementation(down as never),
      vi.spyOn(prisma.siteAuthor, 'create').mockImplementation(down as never),
    ]
    expectErr(await Authors.list('s'), 'DATABASE_ERROR')
    expectErr(await Authors.findById('a', 's'), 'DATABASE_ERROR')
    expectErr(await Authors.findByUser('s', 'u'), 'DATABASE_ERROR')
    expectErr(await Authors.slugsLike('s', 'a'), 'DATABASE_ERROR')
    expectErr(await Authors.count('s'), 'DATABASE_ERROR')
    expectErr(
      await Authors.create({ siteId: 's', name: 'a', slug: 'a' }),
      'DATABASE_ERROR',
    )
    for (const spy of restore) spy.mockRestore()
  })
})

describe('SiteCollectionRepository', () => {
  it('manages collections and items', async () => {
    const { site, other } = await setup()
    const vagas = expectOk(
      await Collections.create({
        siteId: site.id,
        name: 'Vagas',
        itemName: 'Vaga',
        slug: 'vagas',
        fields: [],
        position: 0,
      }),
    )
    expectErr(
      await Collections.create({
        siteId: site.id,
        name: 'X',
        itemName: 'X',
        slug: 'vagas',
        fields: [],
        position: 1,
      }),
      'SITE_COLLECTION_SLUG_TAKEN',
    )
    const casos = expectOk(
      await Collections.create({
        siteId: site.id,
        name: 'Casos',
        itemName: 'Caso',
        slug: 'casos',
        fields: [],
        position: 1,
      }),
    )
    expect(
      expectOk(await Collections.list(site.id)).map((c) => c.slug),
    ).toEqual(['vagas', 'casos'])
    expect(expectOk(await Collections.findById(vagas.id, site.id)).name).toBe(
      'Vagas',
    )
    expectErr(
      await Collections.findById(vagas.id, other.id),
      'SITE_COLLECTION_NOT_FOUND',
    )
    expect(expectOk(await Collections.count(site.id))).toBe(2)
    expect(
      expectOk(await Collections.update(vagas.id, { templateGlobalId: 'g1' }))
        .templateGlobalId,
    ).toBe('g1')
    expectErr(
      await Collections.update(vagas.id, { slug: 'casos' }),
      'SITE_COLLECTION_SLUG_TAKEN',
    )
    expectErr(await Collections.update('nope', { name: 'x' }), 'DATABASE_ERROR')

    const base = {
      collectionId: vagas.id,
      data: {},
      status: 'DRAFT' as const,
      publishedAt: null,
    }
    const dev = expectOk(
      await Collections.createItem({
        ...base,
        title: 'Dev',
        slug: 'dev',
        position: 0,
      }),
    )
    const ana = expectOk(
      await Collections.createItem({
        ...base,
        title: 'Analista',
        slug: 'analista',
        position: 1,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      }),
    )
    expectErr(
      await Collections.createItem({
        ...base,
        title: 'X',
        slug: 'dev',
        position: 2,
      }),
      'SITE_COLLECTION_ITEM_SLUG_TAKEN',
    )
    expect(
      expectOk(await Collections.listItems(vagas.id)).map((i) => i.slug),
    ).toEqual(['dev', 'analista'])
    expect(
      expectOk(await Collections.listItems(vagas.id, { status: 'PUBLISHED' })),
    ).toHaveLength(1)
    expect(
      expectOk(await Collections.listItems(vagas.id, { search: 'ANAL' })),
    ).toHaveLength(1)
    expect(expectOk(await Collections.findItem(dev.id, vagas.id)).title).toBe(
      'Dev',
    )
    expectErr(
      await Collections.findItem(dev.id, casos.id),
      'SITE_COLLECTION_ITEM_NOT_FOUND',
    )
    expect(
      expectOk(await Collections.findItemsInSite(site.id, [dev.id]))[0]
        .collection.id,
    ).toBe(vagas.id)
    expect(
      expectOk(await Collections.findItemsInSite(other.id, [dev.id])),
    ).toEqual([])
    expect(expectOk(await Collections.countItems(vagas.id))).toBe(2)
    expect(expectOk(await Collections.itemSlugsLike(vagas.id, 'de'))).toEqual([
      'dev',
    ])
    expect(
      expectOk(await Collections.itemSlugsLike(vagas.id, 'de', dev.id)),
    ).toEqual([])
    expect(
      expectOk(await Collections.updateItem(dev.id, { title: 'Dev 2' })).title,
    ).toBe('Dev 2')
    expectErr(
      await Collections.updateItem(dev.id, { slug: 'analista' }),
      'SITE_COLLECTION_ITEM_SLUG_TAKEN',
    )
    expectErr(
      await Collections.updateItem('nope', { title: 'x' }),
      'DATABASE_ERROR',
    )
    expectOk(
      await Collections.reorderItems(vagas.id, [ana.id, dev.id, 'foreign']),
    )
    expect(
      expectOk(await Collections.listItems(vagas.id)).map((i) => i.slug),
    ).toEqual(['analista', 'dev'])
    const published = expectOk(await Collections.listPublished(site.id))
    expect(published.map((c) => [c.slug, c.items.length])).toEqual([
      ['vagas', 1],
      ['casos', 0],
    ])
    expect(
      expectOk(await Collections.listPublished(site.id, [casos.id])),
    ).toHaveLength(1)
    expectOk(await Collections.deleteItem(dev.id))
    expectErr(await Collections.deleteItem(dev.id), 'DATABASE_ERROR')
    expectOk(await Collections.delete(vagas.id))
    expectErr(await Collections.delete(vagas.id), 'DATABASE_ERROR')
  })

  it('maps database failures', async () => {
    const restore = [
      vi
        .spyOn(prisma.siteCollection, 'findMany')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.siteCollection, 'findFirst')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.siteCollection, 'count')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.siteCollection, 'create')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.siteCollectionItem, 'findMany')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.siteCollectionItem, 'findFirst')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.siteCollectionItem, 'count')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.siteCollectionItem, 'create')
        .mockImplementation(down as never),
      vi.spyOn(prisma, '$transaction').mockImplementation(down as never),
    ]
    expectErr(await Collections.list('s'), 'DATABASE_ERROR')
    expectErr(await Collections.findById('a', 's'), 'DATABASE_ERROR')
    expectErr(await Collections.count('s'), 'DATABASE_ERROR')
    expectErr(
      await Collections.create({
        siteId: 's',
        name: 'a',
        itemName: 'a',
        slug: 'a',
        fields: [],
        position: 0,
      }),
      'DATABASE_ERROR',
    )
    expectErr(await Collections.listItems('c'), 'DATABASE_ERROR')
    expectErr(await Collections.findItem('a', 'c'), 'DATABASE_ERROR')
    expectErr(await Collections.findItemsInSite('s', ['a']), 'DATABASE_ERROR')
    expectErr(await Collections.countItems('c'), 'DATABASE_ERROR')
    expectErr(await Collections.itemSlugsLike('c', 'a'), 'DATABASE_ERROR')
    expectErr(
      await Collections.createItem({
        collectionId: 'c',
        title: 'a',
        slug: 'a',
        data: {},
        status: 'DRAFT',
        position: 0,
        publishedAt: null,
      }),
      'DATABASE_ERROR',
    )
    expectErr(await Collections.reorderItems('c', ['a']), 'DATABASE_ERROR')
    expectErr(await Collections.listPublished('s'), 'DATABASE_ERROR')
    for (const spy of restore) spy.mockRestore()
  })
})
