import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { SdKbEngagementCache } from '@/src/cache/sd-kb-engagement.cache'
import {
  sdKbArticleMoveInvalid,
  sdKbArticleNotFound,
  sdNotAgent,
  storageError,
  validationError,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { extractSdKbPlainText } from '@/src/lib/servicedesk/sd-kb-text'
import {
  toSdKbArticleDTO,
  toSdKbArticleSummaryDTO,
  toSdKbCategoryDTO,
  toSdKbSearchResultDTO,
} from '@/src/mappers/sd-kb-article.mapper'
import {
  SdKbArticleRepository,
  type SdKbArticleWithRefs,
} from '@/src/repositories/sd-kb-article.repository'
import { SdKbCatalogRepository } from '@/src/repositories/sd-kb-catalog.repository'
import type {
  CreateSdKbArticleDTO,
  ListSdKbArticlesDTO,
  MoveSdKbArticleDTO,
  SearchSdKbArticlesDTO,
  SetSdKbArticleStatusDTO,
  UpdateSdKbArticleDTO,
  VoteSdKbArticleDTO,
} from '@/src/schemas/sd-kb-article.schema'
import type {
  SdKbArticleDTO,
  SdKbArticleSummaryDTO,
  SdKbCategoryDTO,
  SdKbMentionableMemberDTO,
  SdKbSearchResultDTO,
  SdKbVoteResultDTO,
} from '@/types/sd-kb-article'
import type { SdAccessContext } from './sd-access'
import {
  canReadSdKbArticle,
  resolveSdKbEditor,
  resolveSdKbReader,
} from './sd-kb-access'
import { SdKbMediaService } from './sd-kb-media.service'
import { emitEntityWebhook } from './webhook-entity-events'

const ENTITY = 'sd_kb_article'
const RELATED_LIMIT = 5

type AuditAction =
  | 'create'
  | 'update'
  | 'publish'
  | 'unpublish'
  | 'move'
  | 'archive'
  | 'restore'
  | 'delete'

function audit(
  action: AuditAction,
  actorId: string,
  targetId: string | undefined,
  result: Result<unknown>,
  meta?: Record<string, unknown>,
) {
  if (!result.ok) {
    auditMutation({
      entity: ENTITY,
      action,
      actorId,
      targetId,
      outcome: 'failure',
      reason: result.error.code,
      meta,
    })
    return
  }
  auditMutation({ entity: ENTITY, action, actorId, targetId, meta })
}

/**
 * Artigo que o leitor pode ver. Para o solicitante, um artigo fora do portal
 * responde como inexistente (não revela rascunhos/internos).
 */
async function loadReadable(
  ctx: SdAccessContext,
  workspaceId: string,
  articleId: string,
): Promise<Result<SdKbArticleWithRefs>> {
  const article = await SdKbArticleRepository.findById(articleId, workspaceId)
  if (!article.ok) return article
  if (!canReadSdKbArticle(ctx, article.value)) return err(sdKbArticleNotFound())
  return article
}

async function validateCategory(
  workspaceId: string,
  categoryId: string | null | undefined,
): Promise<Result<void>> {
  if (!categoryId) return ok(undefined)
  const category = await SdKbCatalogRepository.findCategory(
    categoryId,
    workspaceId,
  )
  if (!category.ok) return category
  return ok(undefined)
}

export const SdKbArticleService = {
  /** Árvore da KB (ou a lixeira, só agentes). Solicitante: só o portal. */
  async list(
    actorId: string,
    workspaceId: string,
    filters: ListSdKbArticlesDTO,
  ): Promise<Result<SdKbArticleSummaryDTO[]>> {
    const ctx = await resolveSdKbReader(actorId, workspaceId)
    if (!ctx.ok) return ctx
    if (filters.archived && !ctx.value.isAgent) return err(sdNotAgent())

    const result = await SdKbArticleRepository.listByWorkspace(workspaceId, {
      archived: filters.archived,
      portalOnly: !ctx.value.isAgent,
    })
    if (!result.ok) return result
    return ok(result.value.map(toSdKbArticleSummaryDTO))
  },

  async getById(
    actorId: string,
    workspaceId: string,
    articleId: string,
  ): Promise<Result<SdKbArticleDTO>> {
    const ctx = await resolveSdKbReader(actorId, workspaceId)
    if (!ctx.ok) return ctx

    const article = await loadReadable(ctx.value, workspaceId, articleId)
    if (!article.ok) return article

    const myVote = await SdKbEngagementCache.getVote(articleId, actorId)
    return ok(toSdKbArticleDTO(article.value, myVote))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateSdKbArticleDTO,
  ): Promise<Result<SdKbArticleDTO>> {
    const ctx = await resolveSdKbEditor(actorId, workspaceId, 'CREATE')
    if (!ctx.ok) return ctx

    if (dto.parentId) {
      const parent = await SdKbArticleRepository.findById(
        dto.parentId,
        workspaceId,
      )
      if (!parent.ok) return parent
      if (parent.value.archivedAt) {
        return err(sdKbArticleMoveInvalid('O artigo pai está arquivado'))
      }
    }

    const category = await validateCategory(workspaceId, dto.categoryId)
    if (!category.ok) return category

    const result = await SdKbArticleRepository.create({
      workspaceId,
      parentId: dto.parentId ?? null,
      title: dto.title,
      icon: dto.icon,
      categoryId: dto.categoryId,
      visibility: dto.visibility,
      tags: dto.tags,
      createdById: actorId,
    })
    audit('create', actorId, result.ok ? result.value.id : undefined, result)
    if (!result.ok) return result

    logger.info('sd_kb_article.created', {
      component: 'SdKbArticleService',
      workspaceId,
      articleId: result.value.id,
    })
    void indexSearchDocument('sd-kb-article', workspaceId, result.value.id)
    const created = toSdKbArticleDTO(result.value)
    void emitEntityWebhook(workspaceId, actorId, {
      entity: 'kb_article',
      action: 'created',
      record: created,
    })
    return ok(created)
  },

  /**
   * Metadados e conteúdo (autosave). O texto plano é recalculado a cada
   * `content` salvo. Como na Wiki, o autosave só de conteúdo não é auditado
   * (ruído); metadados e falhas sempre são.
   */
  async update(
    actorId: string,
    workspaceId: string,
    articleId: string,
    dto: UpdateSdKbArticleDTO,
  ): Promise<Result<SdKbArticleDTO>> {
    const ctx = await resolveSdKbEditor(actorId, workspaceId, 'EDIT')
    if (!ctx.ok) return ctx

    const existing = await SdKbArticleRepository.findById(
      articleId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const category = await validateCategory(workspaceId, dto.categoryId)
    if (!category.ok) return category

    const result = await SdKbArticleRepository.update(articleId, {
      title: dto.title,
      icon: dto.icon,
      coverImage: dto.coverImage,
      content: dto.content as Prisma.InputJsonValue | undefined,
      plainText:
        dto.content === undefined
          ? undefined
          : extractSdKbPlainText(dto.content),
      categoryId: dto.categoryId,
      visibility: dto.visibility,
      tags: dto.tags,
      updatedById: actorId,
    })

    const fields = Object.keys(dto)
    const contentOnly = fields.length === 1 && fields[0] === 'content'
    if (!result.ok || !contentOnly) {
      audit('update', actorId, articleId, result, { fields })
    }
    if (!result.ok) return result

    const myVote = await SdKbEngagementCache.getVote(articleId, actorId)
    void indexSearchDocument('sd-kb-article', workspaceId, articleId)
    const updated = toSdKbArticleDTO(result.value, myVote)
    // The editor autosaves the content alone every few seconds: that is not
    // an event (a metadata change, or content sent with it, is).
    if (!contentOnly) {
      void emitEntityWebhook(workspaceId, actorId, {
        entity: 'kb_article',
        action: 'updated',
        record: updated,
      })
    }
    return ok(updated)
  },

  /** Publicar (carimba `publishedAt`) ou voltar para rascunho. */
  async setStatus(
    actorId: string,
    workspaceId: string,
    articleId: string,
    dto: SetSdKbArticleStatusDTO,
  ): Promise<Result<SdKbArticleDTO>> {
    const ctx = await resolveSdKbEditor(actorId, workspaceId, 'EDIT')
    if (!ctx.ok) return ctx

    const existing = await SdKbArticleRepository.findById(
      articleId,
      workspaceId,
    )
    if (!existing.ok) return existing

    if (dto.status === 'PUBLISHED') {
      if (existing.value.archivedAt) {
        return err(validationError('Restaure o artigo antes de publicar'))
      }
      if (!existing.value.title.trim()) {
        return err(validationError('Dê um título ao artigo antes de publicar'))
      }
    }

    const result = await SdKbArticleRepository.setStatus(
      articleId,
      dto.status,
      actorId,
    )
    audit(
      dto.status === 'PUBLISHED' ? 'publish' : 'unpublish',
      actorId,
      articleId,
      result,
    )
    if (!result.ok) return result

    const myVote = await SdKbEngagementCache.getVote(articleId, actorId)
    void indexSearchDocument('sd-kb-article', workspaceId, articleId)
    const changed = toSdKbArticleDTO(result.value, myVote)
    void emitEntityWebhook(workspaceId, actorId, {
      entity: 'kb_article',
      action: dto.status === 'PUBLISHED' ? 'published' : 'unpublished',
      record: changed,
    })
    return ok(changed)
  },

  /** Move/reordena na árvore, barrando ciclos (pai dentro de descendente). */
  async move(
    actorId: string,
    workspaceId: string,
    articleId: string,
    dto: MoveSdKbArticleDTO,
  ): Promise<Result<SdKbArticleDTO>> {
    const ctx = await resolveSdKbEditor(actorId, workspaceId, 'EDIT')
    if (!ctx.ok) return ctx

    const existing = await SdKbArticleRepository.findById(
      articleId,
      workspaceId,
    )
    if (!existing.ok) return existing

    if (dto.parentId) {
      if (dto.parentId === articleId) return err(sdKbArticleMoveInvalid())
      const parent = await SdKbArticleRepository.findById(
        dto.parentId,
        workspaceId,
      )
      if (!parent.ok) return parent
      if (parent.value.archivedAt) {
        return err(sdKbArticleMoveInvalid('O artigo de destino está arquivado'))
      }
      const ancestors = await SdKbArticleRepository.listAncestorIds(
        dto.parentId,
        workspaceId,
      )
      if (!ancestors.ok) return ancestors
      if (ancestors.value.includes(articleId)) {
        return err(sdKbArticleMoveInvalid())
      }
    }

    const result = await SdKbArticleRepository.move(articleId, workspaceId, {
      parentId: dto.parentId,
      position: dto.position,
      updatedById: actorId,
    })
    audit('move', actorId, articleId, result, {
      parentId: dto.parentId,
      position: dto.position,
    })
    if (!result.ok) return result
    void indexSearchDocument('sd-kb-article', workspaceId, articleId)
    return ok(toSdKbArticleDTO(result.value))
  },

  async archive(
    actorId: string,
    workspaceId: string,
    articleId: string,
  ): Promise<Result<SdKbArticleDTO>> {
    const ctx = await resolveSdKbEditor(actorId, workspaceId, 'EDIT')
    if (!ctx.ok) return ctx

    const existing = await SdKbArticleRepository.findById(
      articleId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const result = await SdKbArticleRepository.archive(articleId, actorId)
    audit('archive', actorId, articleId, result)
    if (!result.ok) return result
    void indexSearchDocument('sd-kb-article', workspaceId, articleId)
    return ok(toSdKbArticleDTO(result.value))
  },

  async restore(
    actorId: string,
    workspaceId: string,
    articleId: string,
  ): Promise<Result<SdKbArticleDTO>> {
    const ctx = await resolveSdKbEditor(actorId, workspaceId, 'EDIT')
    if (!ctx.ok) return ctx

    const existing = await SdKbArticleRepository.findById(
      articleId,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value.archivedAt) return ok(toSdKbArticleDTO(existing.value))

    const result = await SdKbArticleRepository.restore(articleId, actorId)
    audit('restore', actorId, articleId, result)
    if (!result.ok) return result
    void indexSearchDocument('sd-kb-article', workspaceId, articleId)
    return ok(toSdKbArticleDTO(result.value))
  },

  /** Exclusão definitiva (subárvore, comentários, vínculos e mídia). */
  async remove(
    actorId: string,
    workspaceId: string,
    articleId: string,
  ): Promise<Result<void>> {
    const ctx = await resolveSdKbEditor(actorId, workspaceId, 'DELETE')
    if (!ctx.ok) return ctx

    const existing = await SdKbArticleRepository.findById(
      articleId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const subtree = await SdKbArticleRepository.listSubtreeIds(articleId)
    if (!subtree.ok) return subtree

    const result = await SdKbArticleRepository.delete(articleId)
    audit('delete', actorId, articleId, result, {
      subtreeSize: subtree.value.length,
    })
    if (!result.ok) return result

    await Promise.all(
      subtree.value.map((id) => SdKbEngagementCache.forgetArticle(id)),
    )
    await SdKbMediaService.purgeArticles(workspaceId, subtree.value)
    void indexSearchDocument('sd-kb-article', workspaceId, articleId)
    void emitEntityWebhook(workspaceId, actorId, {
      entity: 'kb_article',
      action: 'deleted',
      record: toSdKbArticleDTO(existing.value),
    })
    return ok(undefined)
  },

  /** Busca com relevância; o solicitante só encontra o que está no portal. */
  async search(
    actorId: string,
    workspaceId: string,
    filters: SearchSdKbArticlesDTO,
  ): Promise<Result<SdKbSearchResultDTO[]>> {
    const ctx = await resolveSdKbReader(actorId, workspaceId)
    if (!ctx.ok) return ctx

    const agent = ctx.value.isAgent
    const result = await SdKbArticleRepository.search(workspaceId, {
      q: filters.q,
      status: agent ? filters.status : undefined,
      visibility: agent ? filters.visibility : undefined,
      categoryId: filters.categoryId,
      tag: filters.tag,
      limit: filters.limit,
      portalOnly: !agent,
    })
    if (!result.ok) return result
    return ok(result.value.map((row) => toSdKbSearchResultDTO(row, filters.q)))
  },

  /** Categorias do catálogo com a contagem de artigos visíveis ao leitor. */
  async listCategories(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SdKbCategoryDTO[]>> {
    const ctx = await resolveSdKbReader(actorId, workspaceId)
    if (!ctx.ok) return ctx

    const result = await SdKbCatalogRepository.listCategoriesWithCounts(
      workspaceId,
      !ctx.value.isAgent,
    )
    if (!result.ok) return result
    return ok(result.value.map(toSdKbCategoryDTO))
  },

  async listRelated(
    actorId: string,
    workspaceId: string,
    articleId: string,
  ): Promise<Result<SdKbArticleSummaryDTO[]>> {
    const ctx = await resolveSdKbReader(actorId, workspaceId)
    if (!ctx.ok) return ctx

    const article = await loadReadable(ctx.value, workspaceId, articleId)
    if (!article.ok) return article

    const result = await SdKbArticleRepository.listRelated(article.value, {
      portalOnly: !ctx.value.isAgent,
      limit: RELATED_LIMIT,
    })
    if (!result.ok) return result
    return ok(result.value.map(toSdKbArticleSummaryDTO))
  },

  /** Conta a visualização uma vez por usuário por dia. */
  async recordView(
    actorId: string,
    workspaceId: string,
    articleId: string,
  ): Promise<Result<{ viewCount: number; counted: boolean }>> {
    const ctx = await resolveSdKbReader(actorId, workspaceId)
    if (!ctx.ok) return ctx

    const article = await loadReadable(ctx.value, workspaceId, articleId)
    if (!article.ok) return article
    if (article.value.archivedAt) {
      return ok({ viewCount: article.value.viewCount, counted: false })
    }

    const first = await SdKbEngagementCache.markViewed(articleId, actorId)
    if (!first)
      return ok({ viewCount: article.value.viewCount, counted: false })

    const result = await SdKbArticleRepository.incrementViews(articleId)
    if (!result.ok) return result
    return ok({ viewCount: result.value, counted: true })
  },

  /** "Este artigo ajudou?" — um voto por usuário (pode trocar ou retirar). */
  async vote(
    actorId: string,
    workspaceId: string,
    articleId: string,
    dto: VoteSdKbArticleDTO,
  ): Promise<Result<SdKbVoteResultDTO>> {
    const ctx = await resolveSdKbReader(actorId, workspaceId)
    if (!ctx.ok) return ctx

    const article = await loadReadable(ctx.value, workspaceId, articleId)
    if (!article.ok) return article

    const next = dto.helpful === null ? null : dto.helpful ? 'up' : 'down'
    const previous = await SdKbEngagementCache.swapVote(
      articleId,
      actorId,
      next,
    )
    if (previous === undefined) {
      return err(storageError('Não foi possível registrar o voto agora'))
    }

    const delta = { helpful: 0, notHelpful: 0 }
    if (previous === 'up') delta.helpful -= 1
    if (previous === 'down') delta.notHelpful -= 1
    if (next === 'up') delta.helpful += 1
    if (next === 'down') delta.notHelpful += 1

    if (delta.helpful === 0 && delta.notHelpful === 0) {
      return ok({
        helpfulCount: article.value.helpfulCount,
        notHelpfulCount: article.value.notHelpfulCount,
        myVote: next,
      })
    }

    const counts = await SdKbArticleRepository.applyVoteDelta(articleId, delta)
    if (!counts.ok) {
      // Desfaz a troca no Redis para o voto não ficar sem contagem.
      await SdKbEngagementCache.swapVote(articleId, actorId, previous)
      return counts
    }
    return ok({ ...counts.value, myVote: next })
  },

  /** Membros para @menção no editor (só agentes editam). */
  async listMentionableMembers(
    actorId: string,
    workspaceId: string,
    q: string,
  ): Promise<Result<SdKbMentionableMemberDTO[]>> {
    const ctx = await resolveSdKbEditor(actorId, workspaceId, 'VIEW')
    if (!ctx.ok) return ctx
    return SdKbCatalogRepository.listMembers(workspaceId, q)
  },
}
