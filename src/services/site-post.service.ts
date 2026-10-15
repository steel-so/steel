import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { appError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import {
  excerptOf,
  plateToHtml,
  plateToPlainText,
  readingStats,
} from '@/src/lib/sites/blog/plate'
import { firstFreeSlug } from '@/src/lib/sites/blog/routes'
import { resolvePublication } from '@/src/lib/sites/blog/schedule'
import { revalidateSites } from '@/src/lib/sites/cache'
import { slugify } from '@/src/lib/sites/slug'
import {
  toSitePostDTO,
  toSitePostSummaryDTO,
} from '@/src/mappers/site-blog.mapper'
import { SiteAuthorRepository } from '@/src/repositories/site-author.repository'
import { SiteBlogTermRepository } from '@/src/repositories/site-blog-term.repository'
import {
  SitePostRepository,
  type SitePostWriteData,
} from '@/src/repositories/site-post.repository'
import type {
  BulkSitePostsDTO,
  CreateSitePostDTO,
  ListSitePostsQueryDTO,
  UpdateSitePostDTO,
} from '@/src/schemas/site-blog.schema'
import type {
  SiteBulkPostsResultDTO,
  SitePostDTO,
  SitePostPageDTO,
} from '@/types/site-blog'
import { authorizeSite } from './site-access'

/**
 * Blog posts of a site (slice site-blog). Same gate as the rest of Sites
 * (CRM module + `landing-pages` permission). A post goes live on its own:
 * saving a PUBLISHED post expires the site's cache right away; SCHEDULED
 * ones are published by the `site-post-schedule` job.
 */

/** Abuse guard. */
export const MAX_POSTS_PER_SITE = 5000
export const POST_SLUG_MAX = 80

const json = (value: unknown) => value as Prisma.InputJsonValue

/** Body fields derived from the Plate value (HTML, text, card excerpt,
 * reading time). */
export function renderPostBody(
  content: unknown,
): Pick<
  SitePostWriteData,
  'contentHtml' | 'plainText' | 'autoExcerpt' | 'wordCount' | 'readingMinutes'
> {
  const { html } = plateToHtml(content)
  const plainText = plateToPlainText(content)
  return {
    contentHtml: html,
    plainText,
    autoExcerpt: excerptOf(plainText, 220),
    ...readingStats(plainText),
  }
}

async function freePostSlug(
  siteId: string,
  base: string,
  excludeId?: string,
): Promise<Result<string>> {
  const used = await SitePostRepository.slugsLike(siteId, base, excludeId)
  if (!used.ok) return used
  return ok(firstFreeSlug(base, used.value, POST_SLUG_MAX))
}

/** Category/tag/author ids must belong to the site; new tags are created
 * by name. Returns the final tag ids. */
async function checkRelations(
  siteId: string,
  dto: Pick<
    UpdateSitePostDTO,
    'authorId' | 'categoryIds' | 'tagIds' | 'newTags'
  >,
): Promise<Result<{ categoryIds?: string[]; tagIds?: string[] }>> {
  if (dto.authorId) {
    const author = await SiteAuthorRepository.findById(dto.authorId, siteId)
    if (!author.ok) return author
  }
  const categoryIds = dto.categoryIds
    ? [...new Set(dto.categoryIds)]
    : undefined
  let tagIds = dto.tagIds ? [...new Set(dto.tagIds)] : undefined
  if (categoryIds?.length || tagIds?.length) {
    const owned = await SiteBlogTermRepository.countOwned(
      siteId,
      categoryIds ?? [],
      tagIds ?? [],
    )
    if (!owned.ok) return owned
    if (
      owned.value.categories !== (categoryIds?.length ?? 0) ||
      owned.value.tags !== (tagIds?.length ?? 0)
    ) {
      return err(
        appError(
          'SITE_BLOG_TERM_NOT_FOUND',
          'Categoria ou tag não encontrada neste site',
        ),
      )
    }
  }
  if (dto.newTags?.length) {
    const wanted = new Map<string, string>()
    for (const name of dto.newTags) {
      const slug = slugify(name, 60)
      if (slug && !wanted.has(slug)) wanted.set(slug, name.trim())
    }
    const created = await SiteBlogTermRepository.upsertTags(
      siteId,
      [...wanted].map(([slug, name]) => ({ slug, name })),
    )
    if (!created.ok) return created
    tagIds = [
      ...new Set([...(tagIds ?? []), ...created.value.map((t) => t.id)]),
    ]
  }
  return ok({ categoryIds, tagIds })
}

export const SitePostService = {
  async list(
    actorId: string,
    workspaceId: string,
    siteId: string,
    query: ListSitePostsQueryDTO,
  ): Promise<Result<SitePostPageDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const page = await SitePostRepository.list(siteId, query)
    if (!page.ok) return page
    return ok({
      items: page.value.items.map(toSitePostSummaryDTO),
      total: page.value.total,
      page: query.page,
      pageSize: query.pageSize,
    })
  },

  async get(
    actorId: string,
    workspaceId: string,
    siteId: string,
    postId: string,
  ): Promise<Result<SitePostDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const post = await SitePostRepository.findById(postId, siteId)
    if (!post.ok) return post
    return ok(toSitePostDTO(post.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: CreateSitePostDTO,
    now: Date = new Date(),
  ): Promise<Result<SitePostDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const total = await SitePostRepository.count(siteId)
    if (!total.ok) return total
    if (total.value >= MAX_POSTS_PER_SITE) {
      return err(
        appError(
          'SITE_LIMIT_REACHED',
          `Um site pode ter até ${MAX_POSTS_PER_SITE} posts`,
        ),
      )
    }

    const relations = await checkRelations(siteId, dto)
    if (!relations.ok) return relations

    const slug = await freePostSlug(
      siteId,
      dto.slug ?? (slugify(dto.title, POST_SLUG_MAX) || 'post'),
    )
    if (!slug.ok) return slug
    if (dto.slug && slug.value !== dto.slug) {
      return err(
        appError('SITE_POST_SLUG_TAKEN', 'Já existe um post com este endereço'),
      )
    }

    const publication = resolvePublication(
      { status: dto.status ?? 'DRAFT', publishedAt: dto.publishedAt },
      null,
      now,
    )
    if (!publication.ok) {
      return err(appError('VALIDATION_ERROR', publication.message))
    }

    const content = dto.content ?? []
    const created = await SitePostRepository.create(
      {
        siteId,
        title: dto.title,
        slug: slug.value,
        excerpt: dto.excerpt ?? null,
        content: json(content),
        ...renderPostBody(content),
        coverImageUrl: dto.coverImageUrl ?? null,
        coverImageAlt: dto.coverImageAlt ?? null,
        authorId: dto.authorId ?? null,
        status: publication.status,
        publishedAt: publication.publishedAt,
        featured: dto.featured ?? false,
        seo: json(dto.seo ?? {}),
        createdById: actorId,
        updatedById: actorId,
      },
      relations.value,
    )
    if (!created.ok) return created

    if (publication.status !== 'DRAFT') revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_post',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { siteId, status: publication.status },
    })
    logger.info('site_post.created', {
      component: 'SitePostService',
      siteId,
      postId: created.value.id,
      status: publication.status,
    })
    return ok(toSitePostDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    siteId: string,
    postId: string,
    dto: UpdateSitePostDTO,
    now: Date = new Date(),
  ): Promise<Result<SitePostDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const current = await SitePostRepository.findById(postId, siteId)
    if (!current.ok) return current

    const relations = await checkRelations(siteId, dto)
    if (!relations.ok) return relations

    const data: SitePostWriteData = { updatedById: actorId }
    if (dto.title !== undefined) data.title = dto.title
    if (dto.slug !== undefined && dto.slug !== current.value.slug) {
      const slug = await freePostSlug(siteId, dto.slug, postId)
      if (!slug.ok) return slug
      if (slug.value !== dto.slug) {
        return err(
          appError(
            'SITE_POST_SLUG_TAKEN',
            'Já existe um post com este endereço',
          ),
        )
      }
      data.slug = dto.slug
    }
    if (dto.excerpt !== undefined) data.excerpt = dto.excerpt
    if (dto.content !== undefined) {
      data.content = json(dto.content)
      Object.assign(data, renderPostBody(dto.content))
    }
    if (dto.coverImageUrl !== undefined) data.coverImageUrl = dto.coverImageUrl
    if (dto.coverImageAlt !== undefined) data.coverImageAlt = dto.coverImageAlt
    if (dto.authorId !== undefined) data.authorId = dto.authorId
    if (dto.featured !== undefined) data.featured = dto.featured
    if (dto.seo !== undefined) data.seo = json(dto.seo)
    if (dto.status !== undefined || dto.publishedAt !== undefined) {
      const publication = resolvePublication(
        {
          status: dto.status ?? current.value.status,
          publishedAt: dto.publishedAt,
        },
        {
          status: current.value.status,
          publishedAt: current.value.publishedAt,
        },
        now,
      )
      if (!publication.ok) {
        return err(appError('VALIDATION_ERROR', publication.message))
      }
      data.status = publication.status
      data.publishedAt = publication.publishedAt
    }

    const updated = await SitePostRepository.update(
      postId,
      data,
      relations.value,
    )
    if (!updated.ok) return updated

    // Live before or after the change: the public pages must follow.
    if (current.value.status !== 'DRAFT' || updated.value.status !== 'DRAFT') {
      revalidateSites(site.value.slug)
    }
    const published =
      current.value.status !== 'PUBLISHED' &&
      updated.value.status === 'PUBLISHED'
    auditMutation({
      entity: 'site_post',
      action: published ? 'publish' : 'update',
      actorId,
      targetId: postId,
      meta: { siteId, fields: Object.keys(dto), status: updated.value.status },
    })
    return ok(toSitePostDTO(updated.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    siteId: string,
    postId: string,
  ): Promise<Result<void>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'DELETE')
    if (!site.ok) return site
    const current = await SitePostRepository.findById(postId, siteId)
    if (!current.ok) return current
    const removed = await SitePostRepository.delete(postId)
    if (!removed.ok) return removed
    if (current.value.status !== 'DRAFT') revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_post',
      action: 'delete',
      actorId,
      targetId: postId,
      meta: { siteId, slug: current.value.slug },
    })
    return ok(undefined)
  },

  /** Bulk actions of the post list (publish, draft, delete, feature,
   * add/remove a category). Ids of other sites are ignored. */
  async bulk(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: BulkSitePostsDTO,
    now: Date = new Date(),
  ): Promise<Result<SiteBulkPostsResultDTO>> {
    const site = await authorizeSite(
      actorId,
      workspaceId,
      siteId,
      dto.action === 'delete' ? 'DELETE' : 'EDIT',
    )
    if (!site.ok) return site
    const owned = await SitePostRepository.findManyByIds(siteId, dto.ids)
    if (!owned.ok) return owned
    const ids = owned.value.map((post) => post.id)
    if (ids.length === 0) return ok({ affected: 0 })

    let affected: Result<number>
    switch (dto.action) {
      case 'publish':
        affected = await SitePostRepository.publishMany(
          siteId,
          ids,
          now,
          actorId,
        )
        break
      case 'draft':
        affected = await SitePostRepository.updateMany(siteId, ids, {
          status: 'DRAFT',
          updatedById: actorId,
        })
        break
      case 'delete':
        affected = await SitePostRepository.deleteMany(siteId, ids)
        break
      case 'feature':
      case 'unfeature':
        affected = await SitePostRepository.updateMany(siteId, ids, {
          featured: dto.action === 'feature',
          updatedById: actorId,
        })
        break
      default: {
        const category = await SiteBlogTermRepository.findCategory(
          dto.categoryId as string,
          siteId,
        )
        if (!category.ok) return category
        affected = await SitePostRepository.setCategory(
          ids,
          category.value.id,
          dto.action === 'addCategory',
        )
      }
    }
    if (!affected.ok) return affected

    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_post',
      action: dto.action === 'delete' ? 'delete' : 'update',
      actorId,
      targetId: siteId,
      meta: { siteId, bulk: dto.action, count: ids.length },
    })
    return ok({ affected: affected.value })
  },
}
