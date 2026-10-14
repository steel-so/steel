import { wikiDisabled } from '../errors'
import { err, type Result } from '../lib/result'
import { WikiSettingsRepository } from '../repositories/wiki-settings.repository'
import { assertMember, type MembershipContext } from './authz'

/**
 * Entry gate of every wiki page/comment/media operation: workspace membership
 * first (a non-member never learns whether the wiki is on), then the
 * workspace toggle in Ajustes > Wiki.
 */
export async function assertWikiMember(
  actorId: string,
  workspaceId: string,
): Promise<Result<MembershipContext>> {
  const membership = await assertMember(actorId, workspaceId)
  if (!membership.ok) return membership

  const enabled = await WikiSettingsRepository.isEnabled(workspaceId)
  if (!enabled.ok) return enabled
  if (!enabled.value) return err(wikiDisabled())

  return membership
}

/**
 * Who may lock/unlock a page's editing — and keeps editing while it is
 * locked: the page's author or a workspace OWNER/ADMIN.
 */
export function canManageWikiPageLock(
  page: { createdById: string | null },
  actorId: string,
  isPrivileged: boolean,
): boolean {
  return isPrivileged || page.createdById === actorId
}

/** Read-only for this actor: the page is locked and they can't manage it. */
export function isWikiPageReadOnlyFor(
  page: { createdById: string | null; lockedAt: Date | null },
  actorId: string,
  isPrivileged: boolean,
): boolean {
  return (
    page.lockedAt !== null &&
    !canManageWikiPageLock(page, actorId, isPrivileged)
  )
}
