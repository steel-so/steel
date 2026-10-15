import { describe, expect, it } from 'vitest'
import {
  createFakeBlogCategory,
  createFakeBlogTag,
  createFakeCollectionItem,
  createFakeSiteAuthor,
  createFakeSiteCollection,
  createFakeSitePost,
} from '@/src/__tests__/factories/site-blog.factory'
import {
  toSiteAuthorDTO,
  toSiteBlogCategoryDTO,
  toSiteBlogTagDTO,
  toSiteCollectionDTO,
  toSiteCollectionItemDTO,
  toSitePostDTO,
  toSitePostSummaryDTO,
} from '../site-blog.mapper'

describe('site blog mappers', () => {
  it('maps posts with relations, path and parsed SEO', () => {
    const post = createFakeSitePost({
      id: 'p1',
      slug: 'ola',
      publishedAt: new Date('2026-10-15T12:00:00Z'),
      seo: { title: 'T', search: { focusKeyword: 'k' } },
      author: { id: 'a1', name: 'Ana', slug: 'ana' },
      categories: [{ category: { id: 'c1', name: 'Dicas', slug: 'dicas' } }],
      tags: [{ tag: { id: 't1', name: 'seo', slug: 'seo' } }],
    })
    expect(toSitePostSummaryDTO(post)).toMatchObject({
      path: '/blog/ola',
      publishedAt: '2026-10-15T12:00:00.000Z',
      author: { name: 'Ana' },
      categories: [{ slug: 'dicas' }],
      tags: [{ slug: 'seo' }],
    })
    expect(toSitePostDTO(post).seo).toEqual({
      title: 'T',
      search: { focusKeyword: 'k' },
    })
    const bad = toSitePostDTO(
      createFakeSitePost({ content: { x: 1 }, seo: 'x' }),
    )
    expect(bad.content).toEqual([])
    expect(bad.seo).toEqual({})
    expect(bad.publishedAt).toBeNull()
  })

  it('maps terms, authors, collections and items', () => {
    expect(
      toSiteBlogCategoryDTO(createFakeBlogCategory({ _count: { posts: 2 } }))
        .postCount,
    ).toBe(2)
    expect(
      toSiteBlogTagDTO(createFakeBlogTag({ _count: { posts: 1 } })).postCount,
    ).toBe(1)
    expect(
      toSiteAuthorDTO(
        createFakeSiteAuthor({
          links: [{ network: 'x', url: 'https://x.com' }, 'bad'] as never,
        }),
      ).links,
    ).toEqual([])
    expect(
      toSiteAuthorDTO(
        createFakeSiteAuthor({
          links: [{ network: 'x', url: 'https://x.com' }],
        }),
      ).links,
    ).toEqual([{ network: 'x', url: 'https://x.com' }])
    expect(
      toSiteCollectionDTO(createFakeSiteCollection({ _count: { items: 4 } })),
    ).toMatchObject({
      itemCount: 4,
      fields: [{ key: 'resumo' }],
    })
    expect(
      toSiteCollectionItemDTO(
        createFakeCollectionItem({ data: { a: 1 }, publishedAt: new Date(0) }),
      ),
    ).toMatchObject({
      data: { a: 1 },
      publishedAt: '1970-01-01T00:00:00.000Z',
    })
    expect(
      toSiteCollectionItemDTO(createFakeCollectionItem({ data: [1] as never }))
        .data,
    ).toEqual({})
    expect(
      toSiteCollectionItemDTO(createFakeCollectionItem({ data: null as never }))
        .data,
    ).toEqual({})
  })
})
