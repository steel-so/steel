import { randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import type { WikiPageDTO } from '@/types/wiki-page'
import {
  wikiLabelNotFound,
  wikiLockForbidden,
  wikiPageForbidden,
  wikiPageLocked,
  wikiPageNotFound,
} from '../errors'
import { err, ok, type Result } from '../lib/result'
import { publishWikiLockChange } from '../lib/wiki-lock-channel'
import { toWikiPageDTO } from '../mappers/wiki-page.mapper'
import { WikiLabelRepository } from '../repositories/wiki-label.repository'
import {
  type WikiPage,
  WikiPageRepository,
} from '../repositories/wiki-page.repository'
import { WikiPageFavoriteRepository } from '../repositories/wiki-page-favorite.repository'
import type { SetWikiPageLabelsDTO } from '../schemas/wiki-label.schema'
import type {
  CreateWikiPageDTO,
  MoveWikiPageDTO,
  UpdateWikiPageDTO,
} from '../schemas/wiki-page.schema'
import {
  assertWikiMember,
  canManageWikiPageLock,
  isWikiPageReadOnlyFor,
} from './_wiki-access'
import type { MembershipContext } from './authz'

const TITLE_MAX = 255
const COPY_SUFFIX = ' (cópia)'

interface PageAccess {
  membership: MembershipContext
  page: WikiPage
}

/** Membership + wiki on + the page exists in this workspace. */
async function loadPage(
  actorId: string,
  workspaceId: string,
  wikiPageId: string,
): Promise<Result<PageAccess>> {
  const membership = await assertWikiMember(actorId, workspaceId)
  if (!membership.ok) return membership

  const page = await WikiPageRepository.findById(wikiPageId)
  if (!page.ok) return page
  if (page.value.workspaceId !== workspaceId) return err(wikiPageForbidden())

  return ok({ membership: membership.value, page: page.value })
}

/** While locked, only the author and OWNER/ADMIN change the page. */
function assertEditable(
  page: WikiPage,
  actorId: string,
  membership: MembershipContext,
): Result<true> {
  if (isWikiPageReadOnlyFor(page, actorId, membership.isPrivileged)) {
    return err(wikiPageLocked())
  }
  return ok(true)
}

/** The DTO as this viewer sees it (lock rights, favorite). */
async function viewerDTO(
  actorId: string,
  membership: MembershipContext,
  page: WikiPage,
): Promise<Result<WikiPageDTO>> {
  const favorite = await WikiPageFavoriteRepository.isFavorite(actorId, page.id)
  if (!favorite.ok) return favorite

  return ok(
    toWikiPageDTO(page, {
      canManageLock: canManageWikiPageLock(
        page,
        actorId,
        membership.isPrivileged,
      ),
      isFavorite: favorite.value,
    }),
  )
}

/** 192 random bits, URL-safe: 32 base64url characters. */
function newPublicToken(): string {
  return randomBytes(24).toString('base64url')
}

function copyTitle(title: string): string {
  const base = title.trim() || 'Sem título'
  return `${base.slice(0, TITLE_MAX - COPY_SUFFIX.length)}${COPY_SUFFIX}`
}

export const WikiPageService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WikiPageDTO[]>> {
    const membership = await assertWikiMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const [pages, favorites] = await Promise.all([
      WikiPageRepository.listByWorkspace(workspaceId),
      WikiPageFavoriteRepository.listPageIds(actorId, workspaceId),
    ])
    if (!pages.ok) return pages
    if (!favorites.ok) return favorites

    return ok(
      pages.value.map((page) =>
        toWikiPageDTO(page, {
          canManageLock: canManageWikiPageLock(
            page,
            actorId,
            membership.value.isPrivileged,
          ),
          isFavorite: favorites.value.has(page.id),
        }),
      ),
    )
  },

  async getById(
    actorId: string,
    workspaceId: string,
    wikiPageId: string,
  ): Promise<Result<WikiPageDTO>> {
    const access = await loadPage(actorId, workspaceId, wikiPageId)
    if (!access.ok) return access

    return viewerDTO(actorId, access.value.membership, access.value.page)
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateWikiPageDTO,
  ): Promise<Result<WikiPageDTO>> {
    const membership = await assertWikiMember(actorId, workspaceId)
    if (!membership.ok) return membership

    if (dto.parentId) {
      const parent = await WikiPageRepository.findById(dto.parentId)
      if (!parent.ok) return parent

      if (parent.value.workspaceId !== workspaceId) {
        return err(wikiPageForbidden())
      }
    }

    const result = await WikiPageRepository.create({
      workspaceId,
      parentId: dto.parentId ?? null,
      title: dto.title,
      icon: dto.icon,
      createdById: actorId,
    })

    if (!result.ok) {
      auditMutation({
        entity: 'wiki_page',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'wiki_page',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })

    // A new page is never a favorite and its author manages its lock.
    return ok(
      toWikiPageDTO(result.value, { canManageLock: true, isFavorite: false }),
    )
  },

  async update(
    actorId: string,
    workspaceId: string,
    wikiPageId: string,
    dto: UpdateWikiPageDTO,
  ): Promise<Result<WikiPageDTO>> {
    const access = await loadPage(actorId, workspaceId, wikiPageId)
    if (!access.ok) return access
    const { membership, page } = access.value

    const editable = assertEditable(page, actorId, membership)
    if (!editable.ok) return editable

    const result = await WikiPageRepository.update(wikiPageId, {
      title: dto.title,
      icon: dto.icon,
      coverImage: dto.coverImage,
      content: dto.content as Prisma.InputJsonValue | undefined,
      updatedById: actorId,
    })

    // The editor autosaves `content` on every debounced keystroke batch —
    // auditing every one of those would flood the trail with noise for an
    // event nobody reviews. Metadata edits (title/icon/coverImage) are rare,
    // deliberate actions and stay audited; failures are always audited
    // regardless of which fields changed, since those are worth knowing
    // about even for a pure content autosave.
    const isContentOnlyUpdate =
      Object.keys(dto).length === 1 && 'content' in dto

    if (!result.ok) {
      auditMutation({
        entity: 'wiki_page',
        action: 'update',
        actorId,
        targetId: wikiPageId,
        outcome: 'failure',
        reason: result.error.code,
        meta: { fields: Object.keys(dto) },
      })
      return result
    }

    if (!isContentOnlyUpdate) {
      auditMutation({
        entity: 'wiki_page',
        action: 'update',
        actorId,
        targetId: wikiPageId,
        meta: { fields: Object.keys(dto) },
      })
    }

    return viewerDTO(actorId, membership, result.value)
  },

  async move(
    actorId: string,
    workspaceId: string,
    wikiPageId: string,
    dto: MoveWikiPageDTO,
  ): Promise<Result<WikiPageDTO>> {
    const access = await loadPage(actorId, workspaceId, wikiPageId)
    if (!access.ok) return access
    const { membership, page } = access.value

    const editable = assertEditable(page, actorId, membership)
    if (!editable.ok) return editable

    if (dto.parentId) {
      if (dto.parentId === wikiPageId) {
        return err(wikiPageForbidden('Uma página não pode ser pai dela mesma'))
      }
      const parent = await WikiPageRepository.findById(dto.parentId)
      if (!parent.ok) return parent
      if (parent.value.workspaceId !== workspaceId) {
        return err(wikiPageForbidden())
      }
    }

    const result = await WikiPageRepository.move(wikiPageId, {
      parentId: dto.parentId,
      position: dto.position,
      updatedById: actorId,
    })

    if (!result.ok) {
      auditMutation({
        entity: 'wiki_page',
        action: 'move',
        actorId,
        targetId: wikiPageId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'wiki_page',
      action: 'move',
      actorId,
      targetId: wikiPageId,
    })

    return viewerDTO(actorId, membership, result.value)
  },

  async archive(
    actorId: string,
    workspaceId: string,
    wikiPageId: string,
  ): Promise<Result<WikiPageDTO>> {
    const access = await loadPage(actorId, workspaceId, wikiPageId)
    if (!access.ok) return access
    const { membership, page } = access.value

    const editable = assertEditable(page, actorId, membership)
    if (!editable.ok) return editable

    const result = await WikiPageRepository.archive(wikiPageId, actorId)

    if (!result.ok) {
      auditMutation({
        entity: 'wiki_page',
        action: 'archive',
        actorId,
        targetId: wikiPageId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'wiki_page',
      action: 'archive',
      actorId,
      targetId: wikiPageId,
    })

    return viewerDTO(actorId, membership, result.value)
  },

  /**
   * Replaces the page's labels. Any wiki member can label a page (unless it
   * is locked); the labels themselves are managed by OWNER/ADMIN in
   * Ajustes > Wiki.
   */
  async setLabels(
    actorId: string,
    workspaceId: string,
    wikiPageId: string,
    dto: SetWikiPageLabelsDTO,
  ): Promise<Result<WikiPageDTO>> {
    const access = await loadPage(actorId, workspaceId, wikiPageId)
    if (!access.ok) return access
    const { membership, page } = access.value

    const editable = assertEditable(page, actorId, membership)
    if (!editable.ok) return editable

    const labelIds = [...new Set(dto.labelIds)]
    if (labelIds.length > 0) {
      const owned = await WikiLabelRepository.countInWorkspace(
        workspaceId,
        labelIds,
      )
      if (!owned.ok) return owned
      if (owned.value !== labelIds.length) return err(wikiLabelNotFound())
    }

    const result = await WikiLabelRepository.setPageLabels(wikiPageId, labelIds)

    auditMutation({
      entity: 'wiki_page',
      action: 'update',
      actorId,
      targetId: wikiPageId,
      ...(result.ok
        ? {}
        : { outcome: 'failure' as const, reason: result.error.code }),
      meta: { fields: ['labels'], labelCount: labelIds.length },
    })
    if (!result.ok) return result

    const reloaded = await WikiPageRepository.findById(wikiPageId)
    if (!reloaded.ok) return reloaded

    return viewerDTO(actorId, membership, reloaded.value)
  },

  /**
   * Creates the public read-only link (`/w/<publicToken>`). Idempotent: an
   * already published page keeps its link. Follows the edit lock — while
   * locked, only who manages the lock publishes.
   */
  async publish(
    actorId: string,
    workspaceId: string,
    wikiPageId: string,
  ): Promise<Result<WikiPageDTO>> {
    const access = await loadPage(actorId, workspaceId, wikiPageId)
    if (!access.ok) return access
    const { membership, page } = access.value

    const editable = assertEditable(page, actorId, membership)
    if (!editable.ok) return editable

    if (page.publicToken) return viewerDTO(actorId, membership, page)

    const result = await WikiPageRepository.setPublication(wikiPageId, {
      publicToken: newPublicToken(),
      publishedAt: new Date(),
    })

    auditMutation({
      entity: 'wiki_page',
      action: 'publish',
      actorId,
      targetId: wikiPageId,
      ...(result.ok
        ? {}
        : { outcome: 'failure' as const, reason: result.error.code }),
      meta: { workspaceId },
    })
    if (!result.ok) return result

    return viewerDTO(actorId, membership, result.value)
  },

  /** Revokes the public link: the old URL 404s. Idempotent. */
  async unpublish(
    actorId: string,
    workspaceId: string,
    wikiPageId: string,
  ): Promise<Result<WikiPageDTO>> {
    const access = await loadPage(actorId, workspaceId, wikiPageId)
    if (!access.ok) return access
    const { membership, page } = access.value

    const editable = assertEditable(page, actorId, membership)
    if (!editable.ok) return editable

    if (!page.publicToken) return viewerDTO(actorId, membership, page)

    const result = await WikiPageRepository.setPublication(wikiPageId, {
      publicToken: null,
      publishedAt: null,
    })

    auditMutation({
      entity: 'wiki_page',
      action: 'unpublish',
      actorId,
      targetId: wikiPageId,
      ...(result.ok
        ? {}
        : { outcome: 'failure' as const, reason: result.error.code }),
      meta: { workspaceId },
    })
    if (!result.ok) return result

    return viewerDTO(actorId, membership, result.value)
  },

  /**
   * Locks (`locked: true`) or unlocks the page's editing. Only the page's
   * author or a workspace OWNER/ADMIN. Idempotent. Open realtime editors
   * pick up the change within seconds (`publishWikiLockChange`).
   */
  async setLock(
    actorId: string,
    workspaceId: string,
    wikiPageId: string,
    locked: boolean,
  ): Promise<Result<WikiPageDTO>> {
    const access = await loadPage(actorId, workspaceId, wikiPageId)
    if (!access.ok) return access
    const { membership, page } = access.value

    if (!canManageWikiPageLock(page, actorId, membership.isPrivileged)) {
      return err(wikiLockForbidden())
    }

    if ((page.lockedAt !== null) === locked) {
      return viewerDTO(actorId, membership, page)
    }

    const result = await WikiPageRepository.setLock(
      wikiPageId,
      locked
        ? { lockedAt: new Date(), lockedById: actorId }
        : { lockedAt: null, lockedById: null },
    )

    const action = locked ? 'lock' : 'unlock'
    auditMutation({
      entity: 'wiki_page',
      action,
      actorId,
      targetId: wikiPageId,
      ...(result.ok
        ? {}
        : { outcome: 'failure' as const, reason: result.error.code }),
      meta: { workspaceId },
    })
    if (!result.ok) return result

    await publishWikiLockChange({
      wikiPageId,
      lockedAt: result.value.lockedAt?.toISOString() ?? null,
    })
    logger.info(`wiki.page.${action}`, {
      component: 'WikiPageService',
      workspaceId,
      wikiPageId,
      actorId,
    })

    return viewerDTO(actorId, membership, result.value)
  },

  /** Adds (`true`) or removes the page from the viewer's favorites. */
  async setFavorite(
    actorId: string,
    workspaceId: string,
    wikiPageId: string,
    favorite: boolean,
  ): Promise<Result<WikiPageDTO>> {
    const access = await loadPage(actorId, workspaceId, wikiPageId)
    if (!access.ok) return access
    const { membership, page } = access.value

    const result = favorite
      ? await WikiPageFavoriteRepository.add(actorId, wikiPageId)
      : await WikiPageFavoriteRepository.remove(actorId, wikiPageId)
    if (!result.ok) return result

    return ok(
      toWikiPageDTO(page, {
        canManageLock: canManageWikiPageLock(
          page,
          actorId,
          membership.isPrivileged,
        ),
        isFavorite: favorite,
      }),
    )
  },

  /**
   * Copies the page right after the original (same parent): title with
   * " (cópia)", icon, cover, content, Yjs state and labels. Any member may
   * duplicate, even a locked page — the copy is theirs and unlocked.
   */
  async duplicate(
    actorId: string,
    workspaceId: string,
    wikiPageId: string,
  ): Promise<Result<WikiPageDTO>> {
    const access = await loadPage(actorId, workspaceId, wikiPageId)
    if (!access.ok) return access
    const { page } = access.value

    if (page.archivedAt) return err(wikiPageNotFound())

    const result = await WikiPageRepository.duplicate(page, {
      title: copyTitle(page.title),
      createdById: actorId,
    })

    auditMutation({
      entity: 'wiki_page',
      action: 'duplicate',
      actorId,
      targetId: result.ok ? result.value.id : wikiPageId,
      ...(result.ok
        ? {}
        : { outcome: 'failure' as const, reason: result.error.code }),
      meta: { workspaceId, sourceId: wikiPageId },
    })
    if (!result.ok) return result

    return ok(
      toWikiPageDTO(result.value, { canManageLock: true, isFavorite: false }),
    )
  },

  /** Members for the editor's @mention: any wiki member may mention anyone. */
  async listMentionableMembers(
    actorId: string,
    workspaceId: string,
    q: string,
  ): Promise<Result<{ userId: string; name: string; image: string | null }[]>> {
    const membership = await assertWikiMember(actorId, workspaceId)
    if (!membership.ok) return membership

    return WikiPageRepository.listMembers(workspaceId, q)
  },
}
