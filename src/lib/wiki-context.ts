import { cache } from 'react'
import type { WikiPageDTO } from '@/types/wiki-page'
import { WikiSettingsRepository } from '../repositories/wiki-settings.repository'
import { MembershipService } from '../services/membership.service'
import { WikiPageService } from '../services/wiki-page.service'
import { getAuthSession } from './auth-session'

export interface WikiContext {
  userId: string
  userName: string
  /** Avatar shown to the others in the page's presence list. */
  userImage: string | null
  workspaceId: string
  workspaceSlug: string
}

export const getWikiContext = cache(
  async (workspaceSlug: string): Promise<WikiContext | null> => {
    const session = await getAuthSession()
    if (!session.ok) return null

    const membership = await MembershipService.getByUserAndSlug(
      session.value.user.id,
      workspaceSlug,
    )
    if (!membership.ok || !membership.value) return null

    // Ajustes > Wiki: a disabled wiki answers 404, like a disabled module.
    const enabled = await WikiSettingsRepository.isEnabled(
      membership.value.workspaceId,
    )
    if (!enabled.ok || !enabled.value) return null

    return {
      userId: session.value.user.id,
      userName: session.value.user.name,
      userImage: session.value.user.image ?? null,
      workspaceId: membership.value.workspaceId,
      workspaceSlug,
    }
  },
)

export const getWikiPageContext = cache(
  async (
    workspaceSlug: string,
    wikiPageId: string,
  ): Promise<(WikiContext & { page: WikiPageDTO }) | null> => {
    const context = await getWikiContext(workspaceSlug)
    if (!context) return null

    const page = await WikiPageService.getById(
      context.userId,
      context.workspaceId,
      wikiPageId,
    )
    if (!page.ok) return null

    return { ...context, page: page.value }
  },
)

/**
 * The workspace's wiki pages for a server render (the sidebar tree's first
 * paint and the `/wiki` redirect). Null when the list cannot be read: the
 * tree then loads it on the client.
 */
export const getWikiPages = cache(
  async (context: WikiContext): Promise<WikiPageDTO[] | null> => {
    const pages = await WikiPageService.list(
      context.userId,
      context.workspaceId,
    )
    return pages.ok ? pages.value : null
  },
)
