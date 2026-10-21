import type { Workspace } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import {
  notFound,
  workspaceConfirmationMismatch,
  workspaceStatusConflict,
} from '@/src/errors'
import { type AdminActor, recordAdminAction } from '@/src/lib/admin-audit'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toAdminAuditEntryDTO,
  toAdminOperationDTO,
  toAdminWorkspaceDetailDTO,
} from '@/src/mappers/admin-workspace.mapper'
import { AdminAuditLogRepository } from '@/src/repositories/admin-audit-log.repository'
import { AdminOperationRepository } from '@/src/repositories/admin-operation.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import type {
  ChangeWorkspacePlanInput,
  DeleteWorkspaceInput,
  SetWorkspaceAllowedIpsInput,
} from '@/src/schemas/admin.schema'
import type {
  AdminAuditEntryDTO,
  AdminOperationDTO,
  AdminWorkspaceDetailDTO,
} from '@/types/admin-workspace'
import { assertPlatformAdmin } from './authz'
import {
  invalidateWorkspaceCaches,
  queueWorkspaceDeletion,
} from './workspace-deletion'

async function loadWorkspace(
  workspaceId: string,
): Promise<Result<Workspace & { memberCount: number }>> {
  const found = await WorkspaceRepository.findWithMemberCount(workspaceId)
  if (!found.ok) return found
  if (!found.value) return err(notFound('Workspace'))
  return ok(found.value)
}

const actorOf = (admin: { userId: string; email: string }): AdminActor => ({
  userId: admin.userId,
  email: admin.email,
})

/**
 * Ciclo de vida de workspaces pelo admin global: suspender/reativar, troca
 * manual de plano e exclusão definitiva (enfileirada: backup → purge). Toda
 * mutação é auditada (Axiom + `admin_audit_logs`).
 */
export const AdminWorkspaceLifecycleService = {
  async getDetail(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<AdminWorkspaceDetailDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const workspace = await loadWorkspace(workspaceId)
    if (!workspace.ok) return workspace
    return ok(toAdminWorkspaceDetailDTO(workspace.value))
  },

  async suspend(
    actorId: string,
    workspaceId: string,
    reason: string,
  ): Promise<Result<AdminWorkspaceDetailDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const workspace = await loadWorkspace(workspaceId)
    if (!workspace.ok) return workspace
    if (workspace.value.status !== 'ACTIVE') {
      return err(
        workspaceStatusConflict(
          workspace.value.status === 'SUSPENDED'
            ? 'O workspace já está suspenso'
            : 'O workspace está sendo excluído',
        ),
      )
    }

    const updated = await WorkspaceRepository.setStatus(workspaceId, {
      status: 'SUSPENDED',
      suspendedAt: new Date(),
      suspendedReason: reason,
      suspendedById: admin.value.userId,
    })
    if (!updated.ok) return updated
    await invalidateWorkspaceCaches(workspaceId)

    await recordAdminAction({
      actor: actorOf(admin.value),
      action: 'workspace.suspend',
      audit: { entity: 'workspace', action: 'suspend' },
      targetType: 'workspace',
      targetId: workspaceId,
      targetLabel: workspace.value.slug,
      reason,
    })
    logger.info('admin.workspace.suspended', { actorId, workspaceId })

    return ok(
      toAdminWorkspaceDetailDTO({
        ...updated.value,
        memberCount: workspace.value.memberCount,
      }),
    )
  },

  async reactivate(
    actorId: string,
    workspaceId: string,
    reason: string,
  ): Promise<Result<AdminWorkspaceDetailDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const workspace = await loadWorkspace(workspaceId)
    if (!workspace.ok) return workspace
    if (workspace.value.status !== 'SUSPENDED') {
      return err(workspaceStatusConflict('O workspace não está suspenso'))
    }

    const updated = await WorkspaceRepository.setStatus(workspaceId, {
      status: 'ACTIVE',
      suspendedAt: null,
      suspendedReason: null,
      suspendedById: null,
    })
    if (!updated.ok) return updated
    await invalidateWorkspaceCaches(workspaceId)

    await recordAdminAction({
      actor: actorOf(admin.value),
      action: 'workspace.reactivate',
      audit: { entity: 'workspace', action: 'reactivate' },
      targetType: 'workspace',
      targetId: workspaceId,
      targetLabel: workspace.value.slug,
      reason,
      meta: { suspendedReason: workspace.value.suspendedReason },
    })
    logger.info('admin.workspace.reactivated', { actorId, workspaceId })

    return ok(
      toAdminWorkspaceDetailDTO({
        ...updated.value,
        memberCount: workspace.value.memberCount,
      }),
    )
  },

  /**
   * Allowlist de rede do workspace (cliente que só aceita acesso de IPs
   * conhecidos). Lista vazia remove a restrição.
   */
  async setAllowedIps(
    actorId: string,
    workspaceId: string,
    input: SetWorkspaceAllowedIpsInput,
  ): Promise<Result<AdminWorkspaceDetailDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const workspace = await loadWorkspace(workspaceId)
    if (!workspace.ok) return workspace
    if (workspace.value.status === 'DELETING') {
      return err(workspaceStatusConflict('O workspace está sendo excluído'))
    }

    const updated = await WorkspaceRepository.setAllowedIps(
      workspaceId,
      input.allowedIps,
    )
    if (!updated.ok) return updated
    await invalidateWorkspaceCaches(workspaceId)

    await recordAdminAction({
      actor: actorOf(admin.value),
      action: 'workspace.allowed_ips_change',
      audit: { entity: 'workspace', action: 'update' },
      targetType: 'workspace',
      targetId: workspaceId,
      targetLabel: workspace.value.slug,
      reason: input.reason,
      meta: {
        from: workspace.value.allowedIps,
        to: input.allowedIps,
      },
    })

    return ok(
      toAdminWorkspaceDetailDTO({
        ...updated.value,
        memberCount: workspace.value.memberCount,
      }),
    )
  },

  /**
   * Troca manual de plano. Assentos não são editáveis à parte: o limite vem
   * do plano (`limitOf(plan, 'seats')`).
   */
  async changePlan(
    actorId: string,
    workspaceId: string,
    input: ChangeWorkspacePlanInput,
  ): Promise<Result<AdminWorkspaceDetailDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const workspace = await loadWorkspace(workspaceId)
    if (!workspace.ok) return workspace
    if (workspace.value.status === 'DELETING') {
      return err(workspaceStatusConflict('O workspace está sendo excluído'))
    }
    if (workspace.value.activePlan === input.plan) {
      return err(workspaceStatusConflict('O workspace já está nesse plano'))
    }

    const updated = await WorkspaceRepository.setPlan(workspaceId, input.plan)
    if (!updated.ok) return updated
    await invalidateWorkspaceCaches(workspaceId)

    await recordAdminAction({
      actor: actorOf(admin.value),
      action: 'workspace.plan_change',
      audit: { entity: 'workspace', action: 'update' },
      targetType: 'workspace',
      targetId: workspaceId,
      targetLabel: workspace.value.slug,
      reason: input.reason,
      meta: {
        from: workspace.value.activePlan,
        to: input.plan,
        trialCleared: workspace.value.trialEndsAt !== null,
      },
    })

    return ok(
      toAdminWorkspaceDetailDTO({
        ...updated.value,
        memberCount: workspace.value.memberCount,
      }),
    )
  },

  /**
   * Pede a exclusão definitiva: marca o workspace como `DELETING` (bloqueia
   * os membros na hora) e enfileira o job, que cancela as assinaturas no
   * AbacatePay e só apaga depois do backup.
   */
  async requestDeletion(
    actorId: string,
    workspaceId: string,
    input: DeleteWorkspaceInput,
  ): Promise<Result<AdminOperationDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const workspace = await loadWorkspace(workspaceId)
    if (!workspace.ok) return workspace
    if (input.confirmSlug !== workspace.value.slug) {
      return err(workspaceConfirmationMismatch())
    }

    const operation = await queueWorkspaceDeletion({
      workspace: workspace.value,
      requester: actorOf(admin.value),
      reason: input.reason,
      ignoreSubscriptionCancelFailure:
        input.ignoreSubscriptionCancelFailure === true,
    })
    if (!operation.ok) return operation

    await recordAdminAction({
      actor: actorOf(admin.value),
      action: 'workspace.delete_requested',
      audit: { entity: 'workspace', action: 'delete' },
      targetType: 'workspace',
      targetId: workspaceId,
      targetLabel: workspace.value.slug,
      reason: input.reason,
      meta: {
        operationId: operation.value.id,
        memberCount: workspace.value.memberCount,
        plan: workspace.value.activePlan,
        ignoreSubscriptionCancelFailure:
          input.ignoreSubscriptionCancelFailure === true,
      },
    })
    logger.info('admin.workspace.delete_requested', {
      actorId,
      workspaceId,
      operationId: operation.value.id,
    })

    // O job pode já ter começado; a UI acompanha por polling.
    return ok(toAdminOperationDTO(operation.value))
  },

  async listOperations(
    actorId: string,
    params: { workspaceId?: string; limit?: number },
  ): Promise<Result<AdminOperationDTO[]>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const operations = await AdminOperationRepository.listRecent({
      workspaceId: params.workspaceId,
      limit: params.limit ?? 20,
    })
    if (!operations.ok) return operations
    return ok(operations.value.map(toAdminOperationDTO))
  },

  async getOperation(
    actorId: string,
    operationId: string,
  ): Promise<Result<AdminOperationDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const operation = await AdminOperationRepository.findById(operationId)
    if (!operation.ok) return operation
    if (!operation.value) return err(notFound('Operação'))
    return ok(toAdminOperationDTO(operation.value))
  },

  async listAudit(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<AdminAuditEntryDTO[]>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const entries = await AdminAuditLogRepository.listByTarget(
      'workspace',
      workspaceId,
      30,
    )
    if (!entries.ok) return entries
    return ok(entries.value.map(toAdminAuditEntryDTO))
  },
}
