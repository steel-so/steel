import { describe, expect, it, vi } from 'vitest'
import { seedSite } from '@/src/__tests__/factories/site.factory'
import { seedSitePost } from '@/src/__tests__/factories/site-blog.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SitePostRepository as Repo } from '../site-post.repository'

const NOW = new Date('2026-10-15T12:00:00Z')
const PAST = new Date('2026-10-01T12:00:00Z')
const FUTURE = new Date('2026-11-01T12:00:00Z')

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const site = await seedSite(workspace.id, user.id)
  const other = await seedSite(workspace.id, user.id)
  const category = await prisma.siteBlogCategory.create({
    data: { siteId: site.id, name: 'Dicas', slug: 'dicas' },
  })
  const tag = await prisma.siteBlogTag.create({
    data: { siteId: site.id, name: 'seo', slug: 'seo' },
  })
  const author = await prisma.siteAuthor.create({
    data: { siteId: site.id, name: 'Ana', slug: 'ana' },
  })
  return { user, site, other, category, tag, author }
}

describe('SitePostRepository', () => {
  it('creates, finds, updates (with relations) and deletes posts', async () => {
    const { user, site, category, tag, author } = await setup()
    const post = expectOk(
      await Repo.create(
        {
          siteId: site.id,
          title: 'Olá',
          slug: 'ola',
          createdById: user.id,
          authorId: author.id,
          content: [],
        },
        { categoryIds: [category.id], tagIds: [tag.id] },
      ),
    )
    expect(post.categories[0].category.slug).toBe('dicas')
    expect(post.tags[0].tag.slug).toBe('seo')
    expect(post.author?.name).toBe('Ana')
    expectErr(
      await Repo.create({
        siteId: site.id,
        title: 'X',
        slug: 'ola',
        createdById: user.id,
      }),
      'SITE_POST_SLUG_TAKEN',
    )
    expectOk(
      await Repo.create({
        siteId: site.id,
        title: 'Y',
        slug: 'y',
        createdById: user.id,
      }),
    )
    expect(expectOk(await Repo.findById(post.id, site.id)).title).toBe('Olá')
    expectErr(await Repo.findById(post.id, 'outro'), 'SITE_POST_NOT_FOUND')

    const updated = expectOk(
      await Repo.update(
        post.id,
        { title: 'Novo' },
        { categoryIds: [], tagIds: [] },
      ),
    )
    expect(updated.categories).toEqual([])
    expect(updated.tags).toEqual([])
    expect(
      expectOk(await Repo.update(post.id, { title: 'Só título' })).title,
    ).toBe('Só título')
    expectErr(await Repo.update(post.id, { slug: 'y' }), 'SITE_POST_SLUG_TAKEN')
    expectErr(await Repo.update('nope', { title: 'x' }), 'DATABASE_ERROR')

    expect(expectOk(await Repo.slugsLike(site.id, 'ol'))).toEqual(['ola'])
    expect(expectOk(await Repo.slugsLike(site.id, 'ol', post.id))).toEqual([])
    expect(expectOk(await Repo.count(site.id))).toBe(2)
    expect(
      expectOk(await Repo.findManyByIds(site.id, [post.id, 'x'])),
    ).toHaveLength(1)
    expectOk(await Repo.delete(post.id))
    expectErr(await Repo.delete(post.id), 'DATABASE_ERROR')
  })

  it('lists with filters and pagination', async () => {
    const { user, site, category, tag, author } = await setup()
    const a = await seedSitePost(site.id, user.id, {
      title: 'Alpha plano',
      status: 'PUBLISHED',
      authorId: author.id,
    })
    await seedSitePost(site.id, user.id, {
      title: 'Beta',
      excerpt: 'fala de plano',
    })
    await prisma.sitePostCategory.create({
      data: { postId: a.id, categoryId: category.id },
    })
    await prisma.sitePostTag.create({ data: { postId: a.id, tagId: tag.id } })
    const all = expectOk(await Repo.list(site.id, { page: 1, pageSize: 10 }))
    expect(all.total).toBe(2)
    const run = async (filters: Record<string, string>) =>
      expectOk(
        await Repo.list(site.id, { page: 1, pageSize: 10, ...filters }),
      ).items.map((p) => p.id)
    expect(await run({ status: 'PUBLISHED' })).toEqual([a.id])
    expect(await run({ authorId: author.id })).toEqual([a.id])
    expect(await run({ categoryId: category.id })).toEqual([a.id])
    expect(await run({ tagId: tag.id })).toEqual([a.id])
    expect(await run({ search: 'PLANO' })).toHaveLength(2)
    expect(
      expectOk(await Repo.list(site.id, { page: 2, pageSize: 1 })).items,
    ).toHaveLength(1)
  })

  it('runs bulk updates scoped to the site', async () => {
    const { user, site, other, category } = await setup()
    const dated = await seedSitePost(site.id, user.id, { publishedAt: PAST })
    const undated = await seedSitePost(site.id, user.id)
    const scheduledDraft = await seedSitePost(site.id, user.id, {
      publishedAt: FUTURE,
    })
    const foreign = await seedSitePost(other.id, user.id)
    expect(
      expectOk(
        await Repo.publishMany(
          site.id,
          [dated.id, undated.id, scheduledDraft.id, foreign.id],
          NOW,
          user.id,
        ),
      ),
    ).toBe(3)
    const rows = await prisma.sitePost.findMany({
      where: { siteId: site.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(rows.find((r) => r.id === dated.id)?.publishedAt).toEqual(PAST)
    expect(rows.find((r) => r.id === undated.id)?.publishedAt).toEqual(NOW)
    expect(rows.find((r) => r.id === scheduledDraft.id)?.publishedAt).toEqual(
      NOW,
    )
    expect(
      (await prisma.sitePost.findUnique({ where: { id: foreign.id } }))?.status,
    ).toBe('DRAFT')

    expect(
      expectOk(
        await Repo.updateMany(site.id, [dated.id, foreign.id], {
          featured: true,
        }),
      ),
    ).toBe(1)
    expect(
      expectOk(
        await Repo.setCategory([dated.id, undated.id], category.id, true),
      ),
    ).toBe(2)
    expect(
      expectOk(await Repo.setCategory([dated.id], category.id, true)),
    ).toBe(0)
    expect(
      expectOk(await Repo.setCategory([dated.id], category.id, false)),
    ).toBe(1)
    expectErr(
      await Repo.setCategory([dated.id], 'missing', true),
      'DATABASE_ERROR',
    )
    expect(
      expectOk(await Repo.deleteMany(site.id, [dated.id, foreign.id])),
    ).toBe(1)
  })

  it('reads live posts, searches, feeds and publishes due ones', async () => {
    const { user, site, category } = await setup()
    const live = await seedSitePost(site.id, user.id, {
      slug: 'live',
      title: 'Plano de internet',
      plainText: 'Fibra óptica para empresas',
      status: 'PUBLISHED',
      publishedAt: PAST,
    })
    const due = await seedSitePost(site.id, user.id, {
      slug: 'due',
      status: 'SCHEDULED',
      publishedAt: PAST,
    })
    await seedSitePost(site.id, user.id, {
      slug: 'later',
      status: 'SCHEDULED',
      publishedAt: FUTURE,
    })
    await seedSitePost(site.id, user.id, { slug: 'draft', publishedAt: PAST })
    await prisma.sitePostCategory.create({
      data: { postId: live.id, categoryId: category.id },
    })

    expect(
      expectOk(await Repo.listLiveCards(site.id, NOW, 10))
        .map((p) => p.slug)
        .sort(),
    ).toEqual(['due', 'live'])
    const found = expectOk(await Repo.findLiveBySlug(site.id, 'live', NOW))
    expect(found?.categories).toEqual([{ categoryId: category.id }])
    expect(
      expectOk(await Repo.findLiveBySlug(site.id, 'later', NOW)),
    ).toBeNull()
    expect(
      expectOk(
        await Repo.searchLiveIds(site.id, ['fibra', 'EMPRESAS'], NOW, 10),
      ),
    ).toEqual([live.id])
    expect(
      expectOk(await Repo.searchLiveIds(site.id, ['nada'], NOW, 10)),
    ).toEqual([])
    expect(expectOk(await Repo.listLiveForFeed(site.id, NOW, 10))).toHaveLength(
      2,
    )
    expect(
      expectOk(await Repo.listLiveForFeed(site.id, NOW, 10, category.id)),
    ).toHaveLength(1)

    const dueList = expectOk(await Repo.listDue(NOW, 10))
    expect(dueList).toEqual([{ id: due.id, site: { slug: site.slug } }])
    expect(expectOk(await Repo.markPublished([due.id, live.id]))).toBe(1)
  })

  it('maps database failures', async () => {
    const spy = vi
      .spyOn(prisma.sitePost, 'findMany')
      .mockRejectedValue(new Error('down'))
    expectErr(await Repo.slugsLike('s', 'a'), 'DATABASE_ERROR')
    expectErr(await Repo.findManyByIds('s', ['a']), 'DATABASE_ERROR')
    expectErr(await Repo.listLiveCards('s', NOW, 1), 'DATABASE_ERROR')
    expectErr(await Repo.searchLiveIds('s', ['a'], NOW, 1), 'DATABASE_ERROR')
    expectErr(await Repo.listLiveForFeed('s', NOW, 1), 'DATABASE_ERROR')
    expectErr(await Repo.listDue(NOW, 1), 'DATABASE_ERROR')
    expectErr(await Repo.list('s', { page: 1, pageSize: 1 }), 'DATABASE_ERROR')
    spy.mockRestore()
    const one = vi
      .spyOn(prisma.sitePost, 'findFirst')
      .mockRejectedValue(new Error('down'))
    expectErr(await Repo.findById('a', 's'), 'DATABASE_ERROR')
    expectErr(await Repo.findLiveBySlug('s', 'a', NOW), 'DATABASE_ERROR')
    one.mockRestore()
    const count = vi
      .spyOn(prisma.sitePost, 'count')
      .mockRejectedValue(new Error('down'))
    expectErr(await Repo.count('s'), 'DATABASE_ERROR')
    count.mockRestore()
    const create = vi
      .spyOn(prisma.sitePost, 'create')
      .mockRejectedValue(new Error('down'))
    expectErr(
      await Repo.create({
        siteId: 's',
        title: 't',
        slug: 's',
        createdById: 'u',
      }),
      'DATABASE_ERROR',
    )
    create.mockRestore()
    const many = vi
      .spyOn(prisma.sitePost, 'updateMany')
      .mockRejectedValue(new Error('down'))
    expectErr(await Repo.updateMany('s', ['a'], {}), 'DATABASE_ERROR')
    expectErr(await Repo.markPublished(['a']), 'DATABASE_ERROR')
    expectErr(await Repo.publishMany('s', ['a'], NOW, 'u'), 'DATABASE_ERROR')
    many.mockRestore()
    const del = vi
      .spyOn(prisma.sitePost, 'deleteMany')
      .mockRejectedValue(new Error('down'))
    expectErr(await Repo.deleteMany('s', ['a']), 'DATABASE_ERROR')
    del.mockRestore()
  })
})
