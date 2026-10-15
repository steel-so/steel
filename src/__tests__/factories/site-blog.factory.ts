import { createId } from '@paralleldrive/cuid2'
import type { Prisma, SiteCollectionItem, SitePost } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { SiteAuthorWithCount } from '@/src/repositories/site-author.repository'
import type {
  SiteBlogCategoryWithCount,
  SiteBlogTagWithCount,
} from '@/src/repositories/site-blog-term.repository'
import type { SiteCollectionWithCount } from '@/src/repositories/site-collection.repository'
import type {
  SitePostCardRow,
  SitePostWithRelations,
} from '@/src/repositories/site-post.repository'

/** Fakes (unit) and seeds (integration) of the site blog and collections. */

export function createFakeSitePost(
  overrides: Partial<SitePostWithRelations> = {},
): SitePostWithRelations {
  const now = new Date('2026-10-15T12:00:00Z')
  return {
    id: createId(),
    siteId: createId(),
    title: 'Como escolher um plano',
    slug: 'como-escolher-um-plano',
    excerpt: null,
    content: [{ type: 'p', children: [{ text: 'Olá' }] }],
    contentHtml: '<p>Olá</p>',
    plainText: 'Olá',
    autoExcerpt: 'Olá',
    coverImageUrl: null,
    coverImageAlt: null,
    authorId: null,
    status: 'DRAFT',
    featured: false,
    publishedAt: null,
    wordCount: 1,
    readingMinutes: 1,
    seo: {},
    createdById: createId(),
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    author: null,
    categories: [],
    tags: [],
    ...overrides,
  }
}

export function createFakePostCard(
  overrides: Partial<SitePostCardRow> = {},
): SitePostCardRow {
  return {
    id: createId(),
    title: 'Post',
    slug: 'post',
    excerpt: null,
    coverImageUrl: null,
    coverImageAlt: null,
    publishedAt: new Date('2026-10-10T12:00:00Z'),
    updatedAt: new Date('2026-10-11T12:00:00Z'),
    readingMinutes: 3,
    featured: false,
    authorId: null,
    seo: {},
    autoExcerpt: 'Começo do texto',
    categories: [],
    tags: [],
    ...overrides,
  }
}

export function createFakeBlogCategory(
  overrides: Partial<SiteBlogCategoryWithCount> = {},
): SiteBlogCategoryWithCount {
  const now = new Date('2026-10-15T12:00:00Z')
  return {
    id: createId(),
    siteId: createId(),
    name: 'Dicas',
    slug: 'dicas',
    description: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    _count: { posts: 0 },
    ...overrides,
  }
}

export function createFakeBlogTag(
  overrides: Partial<SiteBlogTagWithCount> = {},
): SiteBlogTagWithCount {
  return {
    id: createId(),
    siteId: createId(),
    name: 'seo',
    slug: 'seo',
    createdAt: new Date('2026-10-15T12:00:00Z'),
    _count: { posts: 0 },
    ...overrides,
  }
}

export function createFakeSiteAuthor(
  overrides: Partial<SiteAuthorWithCount> = {},
): SiteAuthorWithCount {
  const now = new Date('2026-10-15T12:00:00Z')
  return {
    id: createId(),
    siteId: createId(),
    userId: null,
    name: 'Ana Souza',
    slug: 'ana-souza',
    bio: null,
    avatarUrl: null,
    links: [],
    createdAt: now,
    updatedAt: now,
    _count: { posts: 0 },
    ...overrides,
  }
}

export function createFakeSiteCollection(
  overrides: Partial<SiteCollectionWithCount> = {},
): SiteCollectionWithCount {
  const now = new Date('2026-10-15T12:00:00Z')
  return {
    id: createId(),
    siteId: createId(),
    name: 'Vagas',
    itemName: 'Vaga',
    slug: 'vagas',
    fields: [{ key: 'resumo', label: 'Resumo', type: 'text' }],
    templateGlobalId: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    _count: { items: 0 },
    ...overrides,
  }
}

export function createFakeCollectionItem(
  overrides: Partial<SiteCollectionItem> = {},
): SiteCollectionItem {
  const now = new Date('2026-10-15T12:00:00Z')
  return {
    id: createId(),
    collectionId: createId(),
    title: 'Back-end',
    slug: 'back-end',
    data: {},
    status: 'DRAFT',
    position: 0,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

// ─── integration seeds ────────────────────────────────────────────────────

export async function seedSitePost(
  siteId: string,
  createdById: string,
  overrides: Partial<Prisma.SitePostUncheckedCreateInput> = {},
): Promise<SitePost> {
  const slug = overrides.slug ?? `post-${createId().slice(0, 8)}`
  return prisma.sitePost.create({
    data: {
      siteId,
      createdById,
      title: 'Post',
      slug,
      ...overrides,
    },
  })
}
