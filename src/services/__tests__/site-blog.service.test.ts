import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSite,
  createFakeSiteGlobal,
  createFakeSnapshot,
} from '@/src/__tests__/factories/site.factory'
import {
  createFakeBlogCategory,
  createFakeBlogTag,
  createFakeCollectionItem,
  createFakePostCard,
  createFakeSiteAuthor,
  createFakeSiteCollection,
  createFakeSitePost,
} from '@/src/__tests__/factories/site-blog.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { defaultBlogTemplate } from '@/src/lib/sites/blog/templates'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/site-post.repository')
vi.mock('@/src/repositories/site-blog-term.repository')
vi.mock('@/src/repositories/site-author.repository')
vi.mock('@/src/repositories/site-collection.repository')
vi.mock('@/src/repositories/site-global.repository')
vi.mock('@/src/cache/site-route.cache', () => ({
  siteRouteCache: { invalidate: vi.fn(async () => {}) },
}))
vi.mock('@/lib/axiom/audit')

import { siteRouteCache } from '@/src/cache/site-route.cache'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteAuthorRepository } from '@/src/repositories/site-author.repository'
import { SiteBlogTermRepository } from '@/src/repositories/site-blog-term.repository'
import { SiteCollectionRepository } from '@/src/repositories/site-collection.repository'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import { SitePostRepository } from '@/src/repositories/site-post.repository'
import { SiteBlogService } from '../site-blog.service'
import {
  SiteBlogPublicService,
  toPostRecord,
} from '../site-blog-public.service'
import { SitePostScheduleService } from '../site-post-schedule.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const posts = vi.mocked(SitePostRepository)
const terms = vi.mocked(SiteBlogTermRepository)
const authors = vi.mocked(SiteAuthorRepository)
const collections = vi.mocked(SiteCollectionRepository)
const globals = vi.mocked(SiteGlobalRepository)

const WS = 'ws1'
const SITE = 'site1'
const NOW = new Date('2026-10-15T12:00:00Z')
const site = createFakeSite({ id: SITE, workspaceId: WS, slug: 'clinica' })

const category = createFakeBlogCategory({
  id: 'c1',
  slug: 'dicas',
  name: 'Dicas',
})
const unused = createFakeBlogCategory({ id: 'c2', slug: 'vazia' })
const tag = createFakeBlogTag({ id: 't1', slug: 'seo' })
const author = createFakeSiteAuthor({
  id: 'a1',
  slug: 'ana',
  links: [{ network: 'x', url: 'https://x.com/ana' }],
})
const card = createFakePostCard({
  id: 'p1',
  slug: 'ola',
  categories: [{ categoryId: 'c1' }],
  tags: [{ tagId: 't1' }],
  authorId: 'a1',
})
const vagas = {
  ...createFakeSiteCollection({ id: 'col1', slug: 'vagas' }),
  items: [
    createFakeCollectionItem({
      id: 'i1',
      slug: 'dev',
      data: { resumo: 'Node' },
      status: 'PUBLISHED',
      publishedAt: NOW,
    }),
    createFakeCollectionItem({ id: 'i2', slug: 'arr', data: ['x'] as never }),
  ],
}

beforeEach(() => {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  sites.findById.mockResolvedValue(ok(site))
  posts.listLiveCards.mockResolvedValue(ok([card]))
  posts.findLiveBySlug.mockResolvedValue(
    ok({
      ...createFakeSitePost({
        id: 'p1',
        slug: 'ola',
        publishedAt: NOW,
        contentHtml: '<p>Oi</p>',
      }),
      seo: {
        search: {
          questions: [{ question: 'Q', answer: 'A' }],
        },
      },
      categories: [{ categoryId: 'c1' }],
      tags: [],
    } as never),
  )
  posts.searchLiveIds.mockResolvedValue(ok(['p1']))
  posts.listLiveForFeed.mockResolvedValue(
    ok([createFakeSitePost({ id: 'p1' })]),
  )
  posts.list.mockResolvedValue(ok({ items: [], total: 0 }))
  posts.listDue.mockResolvedValue(ok([]))
  posts.markPublished.mockResolvedValue(ok(2))
  terms.listCategories.mockResolvedValue(ok([category, unused]))
  terms.listTags.mockResolvedValue(ok([tag]))
  terms.findCategoryBySlug.mockResolvedValue(ok(category))
  authors.list.mockResolvedValue(ok([author]))
  collections.listPublished.mockResolvedValue(ok([vagas]))
  collections.list.mockResolvedValue(
    ok([createFakeSiteCollection({ id: 'col1', templateGlobalId: 'g1' })]),
  )
  collections.listItems.mockResolvedValue(ok([vagas.items[0]]))
  globals.listBySite.mockResolvedValue(ok([]))
  globals.create.mockImplementation(async (data) =>
    ok(createFakeSiteGlobal({ ...data, id: `g-${data.name}` } as never)),
  )
})

describe('SiteBlogService.ensureTemplates', () => {
  it('creates the missing blog templates once', async () => {
    globals.listBySite.mockResolvedValueOnce(
      ok([
        createFakeSiteGlobal({ id: 'g0', kind: 'TEMPLATE', name: 'blog-post' }),
        createFakeSiteGlobal({ id: 'h', kind: 'HEADER', name: 'Cabeçalho' }),
      ]),
    )
    const templates = expectOk(
      await SiteBlogService.ensureTemplates('u1', WS, SITE),
    )
    expect(templates.map((global) => global.name)).toEqual([
      'blog-index',
      'blog-post',
      'blog-category',
      'blog-tag',
      'blog-author',
    ])
    expect(globals.create).toHaveBeenCalledTimes(4)
    expect(globals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'TEMPLATE',
        name: 'blog-index',
        document: defaultBlogTemplate('blog-index'),
      }),
    )
  })

  it('does nothing when all exist and reports errors', async () => {
    globals.listBySite.mockResolvedValueOnce(
      ok(
        [
          'blog-index',
          'blog-post',
          'blog-category',
          'blog-tag',
          'blog-author',
        ].map((name) => createFakeSiteGlobal({ kind: 'TEMPLATE', name })),
      ),
    )
    expect(
      expectOk(await SiteBlogService.ensureTemplates('u1', WS, SITE)),
    ).toHaveLength(5)
    expect(globals.create).not.toHaveBeenCalled()
    globals.listBySite.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteBlogService.ensureTemplates('u1', WS, SITE),
      'DATABASE_ERROR',
    )
    globals.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteBlogService.ensureTemplates('u1', WS, SITE),
      'DATABASE_ERROR',
    )
    membership.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'VIEWER' })),
    )
    expectErr(
      await SiteBlogService.ensureTemplates('u1', WS, SITE),
      'FORBIDDEN',
    )
  })
})

describe('SiteBlogService.preview', () => {
  it('returns the sample blog when there is no post', async () => {
    const preview = expectOk(await SiteBlogService.preview('u1', WS, SITE))
    expect(preview.sample).toBe(true)
    expect(preview.blog.posts).toHaveLength(6)
    expect(preview.post?.html).toContain('<h2')
    expect(preview.collections.col1).toMatchObject({
      hasTemplate: true,
      items: [{ id: 'i1' }],
    })
  })

  it('returns real posts (drafts dated by their last edit)', async () => {
    posts.list.mockResolvedValueOnce(
      ok({
        items: [
          createFakeSitePost({
            id: 'p9',
            status: 'DRAFT',
            contentHtml: '<p>Rascunho</p>',
            seo: { search: { questions: [{ question: 'Q', answer: 'A' }] } },
            categories: [
              { category: { id: 'c1', name: 'Dicas', slug: 'dicas' } },
            ],
            tags: [{ tag: { id: 't1', name: 'seo', slug: 'seo' } }],
          }),
        ],
        total: 1,
      }),
    )
    const preview = expectOk(await SiteBlogService.preview('u1', WS, SITE))
    expect(preview.sample).toBe(false)
    expect(preview.blog.posts[0]).toMatchObject({
      id: 'p9',
      categoryIds: ['c1'],
      tagIds: ['t1'],
      publishedAt: '2026-10-15T12:00:00.000Z',
    })
    expect(preview.post).toMatchObject({
      html: '<p>Rascunho</p>',
      faq: [{ question: 'Q', answer: 'A' }],
    })
    expect(preview.blog.authors[0].links).toEqual([
      { network: 'x', url: 'https://x.com/ana' },
    ])
  })

  it('propagates errors', async () => {
    for (const fail of [
      () => posts.list.mockResolvedValueOnce(err(databaseError())),
      () => terms.listCategories.mockResolvedValueOnce(err(databaseError())),
      () => terms.listTags.mockResolvedValueOnce(err(databaseError())),
      () => authors.list.mockResolvedValueOnce(err(databaseError())),
      () => collections.list.mockResolvedValueOnce(err(databaseError())),
      () => collections.listItems.mockResolvedValueOnce(err(databaseError())),
    ]) {
      fail()
      expectErr(await SiteBlogService.preview('u1', WS, SITE), 'DATABASE_ERROR')
    }
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await SiteBlogService.preview('u1', WS, SITE), 'FORBIDDEN')
  })
})

describe('SiteBlogPublicService', () => {
  it('maps card rows with the excerpt fallback', () => {
    expect(
      toPostRecord(createFakePostCard({ excerpt: '  ', autoExcerpt: 'Auto' }))
        .excerpt,
    ).toBe('Auto')
    expect(
      toPostRecord(createFakePostCard({ excerpt: 'Meu', publishedAt: null }))
        .publishedAt,
    ).toBe('1970-01-01T00:00:00.000Z')
  })

  it('loads the blog data and errors', async () => {
    const data = expectOk(await SiteBlogPublicService.blogData(SITE, NOW))
    expect(data.posts[0]).toMatchObject({
      id: 'p1',
      categoryIds: ['c1'],
      tagIds: ['t1'],
    })
    expect(data.categories).toHaveLength(2)
    expect(data.tags[0].slug).toBe('seo')
    expect(data.authors[0].slug).toBe('ana')
    for (const fail of [
      () => posts.listLiveCards.mockResolvedValueOnce(err(databaseError())),
      () => terms.listCategories.mockResolvedValueOnce(err(databaseError())),
      () => terms.listTags.mockResolvedValueOnce(err(databaseError())),
      () => authors.list.mockResolvedValueOnce(err(databaseError())),
    ]) {
      fail()
      expectErr(
        await SiteBlogPublicService.blogData(SITE, NOW),
        'DATABASE_ERROR',
      )
    }
  })

  it('loads one live post with its FAQ', async () => {
    const post = expectOk(await SiteBlogPublicService.post(SITE, 'ola', NOW))
    expect(post).toMatchObject({
      id: 'p1',
      html: '<p>Oi</p>',
      faq: [{ question: 'Q', answer: 'A' }],
      categoryIds: ['c1'],
    })
    posts.findLiveBySlug.mockResolvedValueOnce(ok(null))
    expect(
      expectOk(await SiteBlogPublicService.post(SITE, 'x', NOW)),
    ).toBeNull()
    posts.findLiveBySlug.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteBlogPublicService.post(SITE, 'x', NOW),
      'DATABASE_ERROR',
    )
  })

  it('searches with the meaningful words only', async () => {
    expect(
      expectOk(await SiteBlogPublicService.search(SITE, 'a  seo plano', NOW)),
    ).toEqual(['p1'])
    expect(posts.searchLiveIds).toHaveBeenCalledWith(
      SITE,
      ['seo', 'plano'],
      NOW,
      1000,
    )
    expect(
      expectOk(await SiteBlogPublicService.search(SITE, 'a', NOW)),
    ).toEqual([])
  })

  it('loads collections with their template flag', async () => {
    const records = expectOk(
      await SiteBlogPublicService.collections(
        SITE,
        ['collection:col1'],
        ['col1'],
      ),
    )
    expect(records.col1).toMatchObject({
      hasTemplate: true,
      items: [
        { id: 'i1', data: { resumo: 'Node' } },
        { id: 'i2', data: {} },
      ],
    })
    expect(collections.listPublished).toHaveBeenCalledWith(SITE, ['col1'])
    collections.listPublished.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteBlogPublicService.collections(SITE, []),
      'DATABASE_ERROR',
    )
  })

  it('lists the dynamic route paths', async () => {
    const snapshot = createFakeSnapshot({
      globals: [
        {
          id: 'g',
          kind: 'TEMPLATE',
          name: 'collection:col1',
          document: defaultBlogTemplate('blog-index'),
        },
      ],
    })
    expect(
      expectOk(await SiteBlogPublicService.routePaths(SITE, snapshot, NOW)),
    ).toEqual([
      '/blog',
      '/blog/ola',
      '/blog/categoria/dicas',
      '/blog/tag/seo',
      '/blog/autor/ana',
      '/vagas/dev',
      '/vagas/arr',
    ])
    posts.listLiveCards.mockResolvedValueOnce(ok([]))
    collections.listPublished.mockResolvedValueOnce(ok([]))
    expect(
      expectOk(
        await SiteBlogPublicService.routePaths(SITE, createFakeSnapshot(), NOW),
      ),
    ).toEqual([])
    posts.listLiveCards.mockResolvedValueOnce(ok([]))
    const withTemplate = createFakeSnapshot({
      globals: [
        {
          id: 'g',
          kind: 'TEMPLATE',
          name: 'blog-index',
          document: defaultBlogTemplate('blog-index'),
        },
      ],
    })
    expect(
      expectOk(await SiteBlogPublicService.routePaths(SITE, withTemplate, NOW)),
    ).toEqual(['/blog'])
    posts.listLiveCards.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteBlogPublicService.routePaths(SITE, snapshot, NOW),
      'DATABASE_ERROR',
    )
    collections.listPublished.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteBlogPublicService.routePaths(SITE, snapshot, NOW),
      'DATABASE_ERROR',
    )
  })

  it('loads feeds of the blog or of one category', async () => {
    expect(
      expectOk(await SiteBlogPublicService.feed(SITE, NOW, 50)),
    ).toMatchObject({ category: undefined })
    expect(
      expectOk(await SiteBlogPublicService.feed(SITE, NOW, 50, 'dicas')),
    ).toMatchObject({ category: 'Dicas' })
    expect(posts.listLiveForFeed).toHaveBeenLastCalledWith(SITE, NOW, 50, 'c1')
    terms.findCategoryBySlug.mockResolvedValueOnce(ok(null))
    expect(
      expectOk(await SiteBlogPublicService.feed(SITE, NOW, 50, 'x')),
    ).toBeNull()
    terms.findCategoryBySlug.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteBlogPublicService.feed(SITE, NOW, 50, 'x'),
      'DATABASE_ERROR',
    )
    posts.listLiveForFeed.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SiteBlogPublicService.feed(SITE, NOW, 50), 'DATABASE_ERROR')
  })

  it('builds sitemap entries', async () => {
    posts.listLiveCards.mockResolvedValueOnce(
      ok([
        card,
        createFakePostCard({ slug: 'oculto', seo: { noindex: true } }),
        createFakePostCard({
          slug: 'canon',
          seo: { canonicalUrl: 'https://x.com' },
        }),
      ]),
    )
    const snapshot = createFakeSnapshot({
      globals: [
        {
          id: 'g',
          kind: 'TEMPLATE',
          name: 'collection:col1',
          document: defaultBlogTemplate('blog-index'),
        },
      ],
    })
    const entries = expectOk(
      await SiteBlogPublicService.sitemap(SITE, snapshot, NOW),
    )
    expect(entries.map((entry) => entry.path)).toEqual([
      '/blog',
      '/blog/ola',
      '/vagas/dev',
      '/vagas/arr',
    ])
    posts.listLiveCards.mockResolvedValueOnce(ok([]))
    expect(
      expectOk(
        await SiteBlogPublicService.sitemap(SITE, createFakeSnapshot(), NOW),
      ),
    ).toEqual([])
    posts.listLiveCards.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteBlogPublicService.sitemap(SITE, snapshot, NOW),
      'DATABASE_ERROR',
    )
    collections.listPublished.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteBlogPublicService.sitemap(SITE, snapshot, NOW),
      'DATABASE_ERROR',
    )
  })

  it('builds llms.txt sections', async () => {
    const snapshot = createFakeSnapshot({
      globals: [
        {
          id: 'g',
          kind: 'TEMPLATE',
          name: 'collection:col1',
          document: defaultBlogTemplate('blog-index'),
        },
      ],
    })
    const sections = expectOk(
      await SiteBlogPublicService.llmsSections(
        SITE,
        snapshot,
        'https://x.com',
        NOW,
      ),
    )
    expect(sections[0]).toMatchObject({
      title: 'Blog',
      links: [{ url: 'https://x.com/blog/ola' }],
    })
    expect(sections[1]).toMatchObject({
      title: 'Vagas',
      links: [
        { url: 'https://x.com/vagas/dev', summary: 'Node' },
        { url: 'https://x.com/vagas/arr' },
      ],
    })
    expect(
      expectOk(
        await SiteBlogPublicService.llmsSections(
          SITE,
          createFakeSnapshot(),
          'https://x.com',
          NOW,
        ),
      ),
    ).toHaveLength(1)
    posts.listLiveCards.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteBlogPublicService.llmsSections(
        SITE,
        snapshot,
        'https://x.com',
        NOW,
      ),
      'DATABASE_ERROR',
    )
    collections.listPublished.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SiteBlogPublicService.llmsSections(
        SITE,
        snapshot,
        'https://x.com',
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('SitePostScheduleService.publishDue', () => {
  it('publishes due posts and expires the route index of each site', async () => {
    expect(expectOk(await SitePostScheduleService.publishDue(NOW))).toEqual({
      published: 0,
      sites: 0,
    })
    posts.listDue.mockResolvedValueOnce(
      ok([
        { id: 'p1', site: { slug: 'a' } },
        { id: 'p2', site: { slug: 'a' } },
        { id: 'p3', site: { slug: 'b' } },
      ]),
    )
    expect(expectOk(await SitePostScheduleService.publishDue(NOW))).toEqual({
      published: 2,
      sites: 2,
    })
    expect(posts.markPublished).toHaveBeenCalledWith(['p1', 'p2', 'p3'])
    expect(siteRouteCache.invalidate).toHaveBeenCalledWith('a')
    expect(siteRouteCache.invalidate).toHaveBeenCalledWith('b')
  })

  it('propagates errors', async () => {
    posts.listDue.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SitePostScheduleService.publishDue(NOW), 'DATABASE_ERROR')
    posts.listDue.mockResolvedValueOnce(ok([{ id: 'p1', site: { slug: 'a' } }]))
    posts.markPublished.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SitePostScheduleService.publishDue(NOW), 'DATABASE_ERROR')
  })
})
