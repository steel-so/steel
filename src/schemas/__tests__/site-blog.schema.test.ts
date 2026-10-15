import { describe, expect, it } from 'vitest'
import {
  BulkSitePostsSchema,
  CreateSiteAuthorSchema,
  CreateSitePostSchema,
  ListSitePostsQuerySchema,
  parseAuthorLinks,
  parseSitePostSeo,
  postFaqOf,
  SiteBlogAiSchema,
  UpdateSiteAuthorSchema,
  UpdateSiteBlogCategorySchema,
  UpdateSiteBlogTagSchema,
  UpdateSitePostSchema,
} from '../site-blog.schema'
import {
  CreateSiteCollectionItemSchema,
  CreateSiteCollectionSchema,
  UpdateSiteCollectionItemSchema,
  UpdateSiteCollectionSchema,
} from '../site-collection.schema'

describe('post schemas', () => {
  it('accepts a full post and coerces the date', () => {
    const parsed = CreateSitePostSchema.parse({
      title: 'Olá',
      slug: 'ola',
      content: [{ type: 'p', children: [{ text: 'x' }] }],
      status: 'SCHEDULED',
      publishedAt: '2026-11-01T12:00:00Z',
      seo: {
        title: 'T',
        search: {
          focusKeyword: 'k',
          questions: [{ question: 'Q', answer: 'A' }],
        },
      },
    })
    expect(parsed.publishedAt).toBeInstanceOf(Date)
    expect(parsed.seo?.search?.focusKeyword).toBe('k')
  })

  it('rejects reserved slugs, empty updates and huge bodies', () => {
    expect(
      CreateSitePostSchema.safeParse({ title: 'x', slug: 'categoria' }).success,
    ).toBe(false)
    expect(UpdateSitePostSchema.safeParse({}).success).toBe(false)
    expect(
      CreateSitePostSchema.safeParse({
        title: 'x',
        content: [{ text: 'a'.repeat(2_000_001) }],
      }).success,
    ).toBe(false)
  })

  it('parses SEO and FAQ safely', () => {
    expect(parseSitePostSeo(undefined)).toEqual({})
    expect(parseSitePostSeo({ title: 1 })).toEqual({})
    expect(
      postFaqOf({ search: { questions: [{ question: 'Q', answer: 'A' }] } }),
    ).toHaveLength(1)
    expect(postFaqOf({})).toEqual([])
  })

  it('parses list queries and bulk actions', () => {
    expect(ListSitePostsQuerySchema.parse({ page: '2' })).toEqual({
      page: 2,
      pageSize: 20,
    })
    expect(
      BulkSitePostsSchema.safeParse({ ids: ['a'], action: 'addCategory' })
        .success,
    ).toBe(false)
    expect(
      BulkSitePostsSchema.safeParse({
        ids: ['a'],
        action: 'addCategory',
        categoryId: 'c',
      }).success,
    ).toBe(true)
    expect(
      BulkSitePostsSchema.safeParse({ ids: ['a'], action: 'delete' }).success,
    ).toBe(true)
  })
})

describe('terms, authors and AI', () => {
  it('validates updates and author links', () => {
    expect(UpdateSiteBlogCategorySchema.safeParse({}).success).toBe(false)
    expect(UpdateSiteBlogTagSchema.safeParse({ name: 'x' }).success).toBe(true)
    expect(UpdateSiteAuthorSchema.safeParse({}).success).toBe(false)
    expect(
      CreateSiteAuthorSchema.safeParse({
        name: 'A',
        links: [{ network: 'x', url: 'x.com' }],
      }).success,
    ).toBe(false)
    expect(parseAuthorLinks(null)).toEqual([])
    expect(
      parseAuthorLinks([{ network: 'x', url: 'https://x.com' }]),
    ).toHaveLength(1)
    expect(parseAuthorLinks('x')).toEqual([])
  })

  it('needs a topic to write and text for the others', () => {
    expect(SiteBlogAiSchema.safeParse({ action: 'write' }).success).toBe(false)
    expect(
      SiteBlogAiSchema.safeParse({ action: 'write', topic: 'x' }).success,
    ).toBe(true)
    expect(
      SiteBlogAiSchema.safeParse({ action: 'faq', text: '  ' }).success,
    ).toBe(false)
    expect(
      SiteBlogAiSchema.safeParse({ action: 'faq', text: 'x' }).success,
    ).toBe(true)
  })
})

describe('collection schemas', () => {
  it('validates collections and items', () => {
    expect(CreateSiteCollectionSchema.parse({ name: 'Vagas' }).fields).toEqual(
      [],
    )
    expect(
      CreateSiteCollectionSchema.safeParse({ name: 'X', slug: 'blog' }).success,
    ).toBe(false)
    expect(UpdateSiteCollectionSchema.safeParse({}).success).toBe(false)
    expect(CreateSiteCollectionItemSchema.parse({ title: 'A' }).data).toEqual(
      {},
    )
    expect(
      CreateSiteCollectionItemSchema.safeParse({
        title: 'A',
        data: { x: 'a'.repeat(200_001) },
      }).success,
    ).toBe(false)
    expect(UpdateSiteCollectionItemSchema.safeParse({}).success).toBe(false)
    expect(
      UpdateSiteCollectionItemSchema.safeParse({
        data: { x: 'a'.repeat(200_001) },
      }).success,
    ).toBe(false)
    expect(
      UpdateSiteCollectionItemSchema.safeParse({ status: 'PUBLISHED' }).success,
    ).toBe(true)
  })
})
