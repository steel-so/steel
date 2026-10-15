import type { Site } from '@prisma/client'
import type { PermissionAction } from '@/src/lib/permissions'
import type { Result } from '@/src/lib/result'
import { SiteRepository } from '@/src/repositories/site.repository'
import { assertModuleMember } from './authz'

/**
 * Sites live in the CRM module and reuse the `landing-pages` permission
 * resource: the "Sites" menu replaces the landing pages, so a profile that
 * could build landing pages can build sites (Membro creates and edits,
 * Visualizador only views, deleting a site needs DELETE).
 */
export const SITES_RESOURCE = 'landing-pages'

export function assertSitesPermission(
  actorId: string,
  workspaceId: string,
  action: PermissionAction,
) {
  return assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: SITES_RESOURCE,
    action,
  })
}

/** Module + permission gate, then the site scoped to the workspace. */
export async function authorizeSite(
  actorId: string,
  workspaceId: string,
  siteId: string,
  action: PermissionAction,
): Promise<Result<Site>> {
  const membership = await assertSitesPermission(actorId, workspaceId, action)
  if (!membership.ok) return membership
  return SiteRepository.findById(siteId, workspaceId)
}
