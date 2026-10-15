import { auditMutation } from '@/lib/axiom/audit'
import { appError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { firstFreeSlug } from '@/src/lib/sites/blog/routes'
import { revalidateSites } from '@/src/lib/sites/cache'
import { slugify } from '@/src/lib/sites/slug'
import {
  toSiteAuthorDTO,
  toSiteBlogCategoryDTO,
  toSiteBlogTagDTO,
} from '@/src/mappers/site-blog.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteAuthorRepository } from '@/src/repositories/site-author.repository'
import { SiteBlogTermRepository } from '@/src/repositories/site-blog-term.repository'
import type {
  CreateSiteAuthorDTO,
  CreateSiteBlogCategoryDTO,
  CreateSiteBlogTagDTO,
  UpdateSiteAuthorDTO,
  UpdateSiteBlogCategoryDTO,
  UpdateSiteBlogTagDTO,
} from '@/src/schemas/site-blog.schema'
import type {
  SiteAuthorDTO,
  SiteBlogCategoryDTO,
  SiteBlogTagDTO,
} from '@/types/site-blog'
import { authorizeSite } from './site-access'

/**
 * Categories, tags and author profiles of a site's blog. Terms and authors
 * are public (archive pages), so every change expires the site's cache.
 */

export const MAX_CATEGORIES_PER_SITE = 200
export const MAX_TAGS_PER_SITE = 1000
export const MAX_AUTHORS_PER_SITE = 100

const limit = (message: string) => appError('SITE_LIMIT_REACHED', message)

export const SiteBlogTaxonomyService = {
  // ─── categories ─────────────────────────────────────────────────────────

  async listCategories(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteBlogCategoryDTO[]>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const list = await SiteBlogTermRepository.listCategories(siteId)
    if (!list.ok) return list
    return ok(list.value.map(toSiteBlogCategoryDTO))
  },

  async createCategory(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: CreateSiteBlogCategoryDTO,
  ): Promise<Result<SiteBlogCategoryDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const total = await SiteBlogTermRepository.countCategories(siteId)
    if (!total.ok) return total
    if (total.value >= MAX_CATEGORIES_PER_SITE) {
      return err(
        limit(`Um blog pode ter até ${MAX_CATEGORIES_PER_SITE} categorias`),
      )
    }
    const created = await SiteBlogTermRepository.createCategory({
      siteId,
      name: dto.name,
      slug: dto.slug ?? (slugify(dto.name, 80) || 'categoria'),
      description: dto.description ?? null,
      position: total.value,
    })
    if (!created.ok) return created
    auditMutation({
      entity: 'site_blog_term',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { siteId, kind: 'category' },
    })
    return ok(toSiteBlogCategoryDTO(created.value))
  },

  async updateCategory(
    actorId: string,
    workspaceId: string,
    siteId: string,
    categoryId: string,
    dto: UpdateSiteBlogCategoryDTO,
  ): Promise<Result<SiteBlogCategoryDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const current = await SiteBlogTermRepository.findCategory(
      categoryId,
      siteId,
    )
    if (!current.ok) return current
    const updated = await SiteBlogTermRepository.updateCategory(categoryId, dto)
    if (!updated.ok) return updated
    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_blog_term',
      action: 'update',
      actorId,
      targetId: categoryId,
      meta: { siteId, kind: 'category', fields: Object.keys(dto) },
    })
    return ok(toSiteBlogCategoryDTO(updated.value))
  },

  async removeCategory(
    actorId: string,
    workspaceId: string,
    siteId: string,
    categoryId: string,
  ): Promise<Result<void>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const current = await SiteBlogTermRepository.findCategory(
      categoryId,
      siteId,
    )
    if (!current.ok) return current
    const removed = await SiteBlogTermRepository.deleteCategory(categoryId)
    if (!removed.ok) return removed
    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_blog_term',
      action: 'delete',
      actorId,
      targetId: categoryId,
      meta: { siteId, kind: 'category' },
    })
    return ok(undefined)
  },

  // ─── tags ───────────────────────────────────────────────────────────────

  async listTags(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteBlogTagDTO[]>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const list = await SiteBlogTermRepository.listTags(siteId)
    if (!list.ok) return list
    return ok(list.value.map(toSiteBlogTagDTO))
  },

  async createTag(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: CreateSiteBlogTagDTO,
  ): Promise<Result<SiteBlogTagDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const total = await SiteBlogTermRepository.countTags(siteId)
    if (!total.ok) return total
    if (total.value >= MAX_TAGS_PER_SITE) {
      return err(limit(`Um blog pode ter até ${MAX_TAGS_PER_SITE} tags`))
    }
    const created = await SiteBlogTermRepository.createTag({
      siteId,
      name: dto.name,
      slug: dto.slug ?? (slugify(dto.name, 60) || 'tag'),
    })
    if (!created.ok) return created
    auditMutation({
      entity: 'site_blog_term',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { siteId, kind: 'tag' },
    })
    return ok(toSiteBlogTagDTO(created.value))
  },

  async updateTag(
    actorId: string,
    workspaceId: string,
    siteId: string,
    tagId: string,
    dto: UpdateSiteBlogTagDTO,
  ): Promise<Result<SiteBlogTagDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const current = await SiteBlogTermRepository.findTag(tagId, siteId)
    if (!current.ok) return current
    const updated = await SiteBlogTermRepository.updateTag(tagId, dto)
    if (!updated.ok) return updated
    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_blog_term',
      action: 'update',
      actorId,
      targetId: tagId,
      meta: { siteId, kind: 'tag', fields: Object.keys(dto) },
    })
    return ok(toSiteBlogTagDTO(updated.value))
  },

  async removeTag(
    actorId: string,
    workspaceId: string,
    siteId: string,
    tagId: string,
  ): Promise<Result<void>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const current = await SiteBlogTermRepository.findTag(tagId, siteId)
    if (!current.ok) return current
    const removed = await SiteBlogTermRepository.deleteTag(tagId)
    if (!removed.ok) return removed
    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_blog_term',
      action: 'delete',
      actorId,
      targetId: tagId,
      meta: { siteId, kind: 'tag' },
    })
    return ok(undefined)
  },

  // ─── authors ────────────────────────────────────────────────────────────

  async listAuthors(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteAuthorDTO[]>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const list = await SiteAuthorRepository.list(siteId)
    if (!list.ok) return list
    return ok(list.value.map(toSiteAuthorDTO))
  },

  async createAuthor(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: CreateSiteAuthorDTO,
  ): Promise<Result<SiteAuthorDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const total = await SiteAuthorRepository.count(siteId)
    if (!total.ok) return total
    if (total.value >= MAX_AUTHORS_PER_SITE) {
      return err(limit(`Um blog pode ter até ${MAX_AUTHORS_PER_SITE} autores`))
    }
    if (dto.userId) {
      const member = await MembershipRepository.findByUserAndWorkspace(
        dto.userId,
        workspaceId,
      )
      if (!member.ok) return member
      if (!member.value) {
        return err(
          appError('VALIDATION_ERROR', 'Escolha um membro deste workspace'),
        )
      }
    }
    const base = dto.slug ?? (slugify(dto.name, 80) || 'autor')
    const used = await SiteAuthorRepository.slugsLike(siteId, base)
    if (!used.ok) return used
    const slug = dto.slug ?? firstFreeSlug(base, used.value)
    const created = await SiteAuthorRepository.create({
      siteId,
      userId: dto.userId ?? null,
      name: dto.name,
      slug,
      bio: dto.bio ?? null,
      avatarUrl: dto.avatarUrl ?? null,
      links: dto.links ?? [],
    })
    if (!created.ok) return created
    // A public profile (name, photo, bio) of a person: LGPD-relevant.
    auditMutation({
      entity: 'site_author',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { siteId, linkedUser: Boolean(dto.userId) },
    })
    return ok(toSiteAuthorDTO(created.value))
  },

  async updateAuthor(
    actorId: string,
    workspaceId: string,
    siteId: string,
    authorId: string,
    dto: UpdateSiteAuthorDTO,
  ): Promise<Result<SiteAuthorDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const current = await SiteAuthorRepository.findById(authorId, siteId)
    if (!current.ok) return current
    if (dto.userId) {
      const member = await MembershipRepository.findByUserAndWorkspace(
        dto.userId,
        workspaceId,
      )
      if (!member.ok) return member
      if (!member.value) {
        return err(
          appError('VALIDATION_ERROR', 'Escolha um membro deste workspace'),
        )
      }
    }
    const updated = await SiteAuthorRepository.update(authorId, dto)
    if (!updated.ok) return updated
    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_author',
      action: 'update',
      actorId,
      targetId: authorId,
      meta: { siteId, fields: Object.keys(dto) },
    })
    return ok(toSiteAuthorDTO(updated.value))
  },

  async removeAuthor(
    actorId: string,
    workspaceId: string,
    siteId: string,
    authorId: string,
  ): Promise<Result<void>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const current = await SiteAuthorRepository.findById(authorId, siteId)
    if (!current.ok) return current
    const removed = await SiteAuthorRepository.delete(authorId)
    if (!removed.ok) return removed
    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_author',
      action: 'delete',
      actorId,
      targetId: authorId,
      meta: { siteId },
    })
    return ok(undefined)
  },
}
