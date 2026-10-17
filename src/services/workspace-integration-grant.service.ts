import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { McpUsageCache } from '@/src/cache/mcp-usage.cache'
import { integrationGrantNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toWorkspaceIntegrationClientDTOs,
  toWorkspaceIntegrationGrantDTO,
} from '@/src/mappers/integration-grant.mapper'
import {
  IntegrationGrantRepository,
  type WorkspaceGrantFilter,
} from '@/src/repositories/integration-grant.repository'
import { assertPrivileged } from '@/src/services/authz'
import type {
  IntegrationGrantRevokeManyDTO,
  WorkspaceIntegrationGrantsDTO,
} from '@/types/integration-grant'

/**
 * Workspace "Apps conectados" (ADR 0033): OWNER/ADMIN see the active OAuth
 * grants of every member — who, which app, scopes, modules, last use and
 * MCP call counts — and can revoke one grant, all of a member's or all of
 * an app's. Revoking cuts the app on its next MCP call.
 */

async function revokeFiltered(
  actorId: string,
  workspaceId: string,
  filter: WorkspaceGrantFilter,
): Promise<Result<IntegrationGrantRevokeManyDTO>> {
  const membership = await assertPrivileged(actorId, workspaceId)
  if (!membership.ok) return membership

  const ids = await IntegrationGrantRepository.listActiveIdsByWorkspace(
    workspaceId,
    filter,
  )
  if (!ids.ok) return ids

  const revoked = await IntegrationGrantRepository.revokeMany(
    ids.value,
    new Date(),
  )
  if (!revoked.ok) return revoked

  if (revoked.value > 0) {
    const target = 'userId' in filter ? 'member' : 'client'
    auditMutation({
      entity: 'integration_grant',
      action: 'revoke',
      actorId,
      targetId: 'userId' in filter ? filter.userId : filter.clientId,
      meta: {
        workspaceId,
        target,
        grantIds: ids.value,
        revoked: revoked.value,
      },
    })
    logger.info('integration_grant.workspace_revoked_many', {
      workspaceId,
      target,
      revoked: revoked.value,
    })
  }
  return ok({ revoked: revoked.value })
}

export const WorkspaceIntegrationGrantService = {
  async list(
    actorId: string,
    workspaceId: string,
    now: Date = new Date(),
  ): Promise<Result<WorkspaceIntegrationGrantsDTO>> {
    const membership = await assertPrivileged(actorId, workspaceId)
    if (!membership.ok) return membership

    const grants =
      await IntegrationGrantRepository.listActiveByWorkspace(workspaceId)
    if (!grants.ok) return grants

    const usage = await McpUsageCache.readWorkspace(workspaceId, now)
    return ok({
      grants: grants.value.map((grant) =>
        toWorkspaceIntegrationGrantDTO(grant, usage.byGrant),
      ),
      clients: toWorkspaceIntegrationClientDTOs(grants.value, usage.byClient),
    })
  },

  /** Revokes one grant of the workspace; one elsewhere reads as missing. */
  async revoke(
    actorId: string,
    workspaceId: string,
    grantId: string,
  ): Promise<Result<{ id: string }>> {
    const membership = await assertPrivileged(actorId, workspaceId)
    if (!membership.ok) return membership

    const grant = await IntegrationGrantRepository.findById(grantId)
    if (!grant.ok) {
      return grant.error.code === 'RESOURCE_NOT_FOUND'
        ? err(integrationGrantNotFound())
        : grant
    }
    if (grant.value.workspaceId !== workspaceId || grant.value.revokedAt) {
      return err(integrationGrantNotFound())
    }

    const revoked = await IntegrationGrantRepository.revoke(grantId, new Date())
    if (!revoked.ok) return revoked

    auditMutation({
      entity: 'integration_grant',
      action: 'revoke',
      actorId,
      targetId: grantId,
      meta: {
        workspaceId,
        target: 'grant',
        clientId: grant.value.clientId,
        holderId: grant.value.userId,
      },
    })
    return ok({ id: grantId })
  },

  /** Revokes every active grant of one member (any app). */
  revokeByMember(
    actorId: string,
    workspaceId: string,
    userId: string,
  ): Promise<Result<IntegrationGrantRevokeManyDTO>> {
    return revokeFiltered(actorId, workspaceId, { userId })
  },

  /** Revokes every member's active grant of one app. */
  revokeByClient(
    actorId: string,
    workspaceId: string,
    clientId: string,
  ): Promise<Result<IntegrationGrantRevokeManyDTO>> {
    return revokeFiltered(actorId, workspaceId, { clientId })
  },
}
