import type { SiteCollectionItem } from '@prisma/client'
import { parseCollectionFields } from '@/src/lib/sites/blog/collections'
import { isPlateValue, type PlateValue } from '@/src/lib/sites/blog/plate'
import { blogPath } from '@/src/lib/sites/blog/routes'
import type { SiteAuthorWithCount } from '@/src/repositories/site-author.repository'
import type {
  SiteBlogCategoryWithCount,
  SiteBlogTagWithCount,
} from '@/src/repositories/site-blog-term.repository'
import type { SiteCollectionWithCount } from '@/src/repositories/site-collection.repository'
import type { SitePostWithRelations } from '@/src/repositories/site-post.repository'
import {
  parseAuthorLinks,
  parseSitePostSeo,
} from '@/src/schemas/site-blog.schema'
import type {
  SiteAuthorDTO,
  SiteBlogCategoryDTO,
  SiteBlogTagDTO,
  SiteCollectionDTO,
  SiteCollectionItemDTO,
  SitePostDTO,
  SitePostSummaryDTO,
} from '@/types/site-blog'

/** Prisma rows of the site blog and collections → API DTOs. */

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export function toSitePostSummaryDTO(
  post: SitePostWithRelations,
): SitePostSummaryDTO {
  return {
    id: post.id,
    siteId: post.siteId,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    coverImageUrl: post.coverImageUrl,
    status: post.status,
    featured: post.featured,
    publishedAt: iso(post.publishedAt),
    readingMinutes: post.readingMinutes,
    author: post.author,
    categories: post.categories.map((entry) => entry.category),
    tags: post.tags.map((entry) => entry.tag),
    path: blogPath({ kind: 'post', slug: post.slug }),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  }
}

export function toSitePostDTO(post: SitePostWithRelations): SitePostDTO {
  return {
    ...toSitePostSummaryDTO(post),
    content: isPlateValue(post.content) ? (post.content as PlateValue) : [],
    coverImageAlt: post.coverImageAlt,
    wordCount: post.wordCount,
    seo: parseSitePostSeo(post.seo),
    createdById: post.createdById,
    updatedById: post.updatedById,
  }
}

export function toSiteBlogCategoryDTO(
  category: SiteBlogCategoryWithCount,
): SiteBlogCategoryDTO {
  return {
    id: category.id,
    siteId: category.siteId,
    name: category.name,
    slug: category.slug,
    description: category.description,
    position: category.position,
    postCount: category._count.posts,
  }
}

export function toSiteBlogTagDTO(tag: SiteBlogTagWithCount): SiteBlogTagDTO {
  return {
    id: tag.id,
    siteId: tag.siteId,
    name: tag.name,
    slug: tag.slug,
    postCount: tag._count.posts,
  }
}

export function toSiteAuthorDTO(author: SiteAuthorWithCount): SiteAuthorDTO {
  return {
    id: author.id,
    siteId: author.siteId,
    userId: author.userId,
    name: author.name,
    slug: author.slug,
    bio: author.bio,
    avatarUrl: author.avatarUrl,
    links: parseAuthorLinks(author.links),
    postCount: author._count.posts,
  }
}

export function toSiteCollectionDTO(
  collection: SiteCollectionWithCount,
): SiteCollectionDTO {
  return {
    id: collection.id,
    siteId: collection.siteId,
    name: collection.name,
    itemName: collection.itemName,
    slug: collection.slug,
    fields: parseCollectionFields(collection.fields),
    templateGlobalId: collection.templateGlobalId,
    itemCount: collection._count.items,
    createdAt: collection.createdAt.toISOString(),
    updatedAt: collection.updatedAt.toISOString(),
  }
}

export function toSiteCollectionItemDTO(
  item: SiteCollectionItem,
): SiteCollectionItemDTO {
  const data =
    typeof item.data === 'object' &&
    item.data !== null &&
    !Array.isArray(item.data)
      ? (item.data as Record<string, unknown>)
      : {}
  return {
    id: item.id,
    collectionId: item.collectionId,
    title: item.title,
    slug: item.slug,
    data,
    status: item.status,
    position: item.position,
    publishedAt: iso(item.publishedAt),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}
