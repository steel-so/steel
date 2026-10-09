import type { ModuleKind } from '@prisma/client'
import { getAuthSession } from '@/src/lib/auth-session'
import { isPrivilegedRole } from '@/src/services/authz'
import { MembershipService } from '@/src/services/membership.service'
import { WorkspaceModuleAccessService } from '@/src/services/workspace-module-access.service'

/**
 * Resolve o entitlement de módulo (Fase 0 do plano admin global) para o
 * layout decidir se chama `notFound()`. Deliberadamente NÃO chama
 * `notFound()` aqui: chamado através de uma função utilitária importada
 * (fora do arquivo do layout/page), o Next não reconhece a chamada como
 * parte do render dinâmico do segmento sob Cache Components — o marcador
 * de erro nunca chega no stream. `notFound()` precisa ser invocado
 * diretamente no corpo do layout/page.
 */
export async function hasModuleAccess(
  slug: string,
  module: ModuleKind,
): Promise<boolean> {
  const session = await getAuthSession()
  if (!session.ok) return false

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) return false

  const access = await WorkspaceModuleAccessService.isModuleEnabled(
    membership.value.workspaceId,
    module,
  )
  return access.ok && access.value
}

/**
 * Whether the signed-in user is OWNER/ADMIN of the workspace — used by
 * layouts to show admin-only entries (the services enforce the same rule).
 */
export async function isWorkspacePrivileged(slug: string): Promise<boolean> {
  const session = await getAuthSession()
  if (!session.ok) return false

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  return (
    membership.ok &&
    !!membership.value &&
    isPrivilegedRole(membership.value.role)
  )
}
