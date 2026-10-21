import type {
  AdminAuditLog,
  AdminOperation,
  Backup,
  Workspace,
} from '@prisma/client'
import type {
  AdminAuditEntryDTO,
  AdminBackupDTO,
  AdminOperationDTO,
  AdminWorkspaceDetailDTO,
  AdminWorkspaceSummaryDTO,
} from '@/types/admin-workspace'

const iso = (date: Date | null) => (date ? date.toISOString() : null)

/** `Prisma.Workspace` (+ contagem de membros) → `AdminWorkspaceSummaryDTO`. */
export function toAdminWorkspaceSummaryDTO(
  workspace: Workspace & { memberCount: number },
): AdminWorkspaceSummaryDTO {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    activePlan: workspace.activePlan,
    status: workspace.status,
    memberCount: workspace.memberCount,
    createdAt: workspace.createdAt.toISOString(),
  }
}

export function toAdminWorkspaceDetailDTO(
  workspace: Workspace & { memberCount: number },
): AdminWorkspaceDetailDTO {
  return {
    ...toAdminWorkspaceSummaryDTO(workspace),
    trialEndsAt: iso(workspace.trialEndsAt),
    suspendedAt: iso(workspace.suspendedAt),
    suspendedReason: workspace.suspendedReason,
    allowedIps: workspace.allowedIps,
    updatedAt: workspace.updatedAt.toISOString(),
  }
}

type Meta = Record<string, unknown>

function asSubscriptions(value: unknown): { billId: string; plan: string }[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is { billId: string; plan: string } =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Meta).billId === 'string',
    )
    .map((item) => ({ billId: item.billId, plan: String(item.plan ?? '') }))
}

export function toAdminOperationDTO(
  operation: AdminOperation,
): AdminOperationDTO {
  const meta = (operation.meta as Meta | null) ?? {}
  return {
    id: operation.id,
    kind: operation.kind,
    status: operation.status,
    step: operation.step,
    workspaceId: operation.workspaceId,
    workspaceSlug: operation.workspaceSlug,
    workspaceName: operation.workspaceName,
    backupId: operation.backupId,
    requestedByEmail: operation.requestedByEmail,
    reason: operation.reason,
    error: operation.error,
    subscriptionsCancelled: asSubscriptions(meta.subscriptionsCancelled),
    subscriptionsToCancel: asSubscriptions(meta.subscriptionsToCancel),
    filesDeleted:
      typeof meta.filesDeleted === 'number' ? meta.filesDeleted : null,
    filesError: typeof meta.filesError === 'string' ? meta.filesError : null,
    safetyBackupId:
      typeof meta.safetyBackupId === 'string' ? meta.safetyBackupId : null,
    createdAt: operation.createdAt.toISOString(),
    updatedAt: operation.updatedAt.toISOString(),
    completedAt: iso(operation.completedAt),
  }
}

export function toAdminBackupDTO(
  backup: Backup,
  existingWorkspaceIds: ReadonlySet<string>,
): AdminBackupDTO {
  return {
    id: backup.id,
    scope: backup.scope,
    status: backup.status,
    workspaceId: backup.workspaceId,
    workspaceSlug: backup.workspaceSlug,
    workspaceExists: backup.workspaceId
      ? existingWorkspaceIds.has(backup.workspaceId)
      : false,
    sizeBytes: backup.sizeBytes,
    files:
      backup.filesKey === null
        ? null
        : {
            count: backup.fileCount ?? 0,
            bytes: Number(backup.fileBytes ?? 0),
          },
    errorMessage: backup.errorMessage,
    locations: {
      local: backup.status === 'COMPLETED' && backup.storageKey !== null,
      offsite: backup.offsiteKey !== null,
    },
    offsiteCopiedAt: iso(backup.offsiteCopiedAt),
    triggeredBy: backup.triggeredById ? 'admin' : 'system',
    startedAt: backup.startedAt.toISOString(),
    completedAt: iso(backup.completedAt),
    expiresAt: iso(backup.expiresAt),
  }
}

export function toAdminAuditEntryDTO(entry: AdminAuditLog): AdminAuditEntryDTO {
  const meta = (entry.meta as Meta | null) ?? {}
  return {
    id: entry.id,
    actorEmail: entry.actorEmail,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    targetLabel: entry.targetLabel,
    reason: entry.reason,
    failed: meta.outcome === 'failure',
    createdAt: entry.createdAt.toISOString(),
  }
}
