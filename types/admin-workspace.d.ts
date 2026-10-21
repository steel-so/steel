import type {
  AdminOperationKind,
  AdminOperationStatus,
  BackupScope,
  BackupStatus,
  ComponentStatus,
  Plan,
  WorkspaceStatus,
} from '@prisma/client'

/** Linha da listagem de workspaces do painel admin global. */
export interface AdminWorkspaceSummaryDTO {
  id: string
  name: string
  slug: string
  activePlan: Plan
  status: WorkspaceStatus
  memberCount: number
  createdAt: string
}

/** Cabeçalho/resumo do detalhe de um workspace no painel admin. */
export interface AdminWorkspaceDetailDTO extends AdminWorkspaceSummaryDTO {
  trialEndsAt: string | null
  suspendedAt: string | null
  suspendedReason: string | null
  allowedIps: string[]
  updatedAt: string
}

/** Exclusão/restauração de workspace executada pelo worker. */
export interface AdminOperationDTO {
  id: string
  kind: AdminOperationKind
  status: AdminOperationStatus
  /**
   * `queued` → `backup` → `cancel_subscriptions` → `purge_database` →
   * `purge_files` → `done` (exclusão) ou `safety_backup` → `restore` →
   * `done` (restauração).
   */
  step: string
  workspaceId: string
  workspaceSlug: string
  workspaceName: string
  backupId: string | null
  requestedByEmail: string
  reason: string
  error: string | null
  /** Assinaturas canceladas automaticamente no AbacatePay (exclusão). */
  subscriptionsCancelled: { billId: string; plan: string }[]
  /**
   * Assinaturas que o AbacatePay recusou cancelar numa exclusão **forçada**:
   * exigem cancelamento manual no painel do provedor. Vazio no caminho
   * normal — uma falha de cancelamento barra a exclusão.
   */
  subscriptionsToCancel: { billId: string; plan: string }[]
  filesDeleted: number | null
  filesError: string | null
  safetyBackupId: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface AdminBackupDTO {
  id: string
  scope: BackupScope
  status: BackupStatus
  workspaceId: string | null
  workspaceSlug: string | null
  /** `false` quando o workspace do backup não existe mais. */
  workspaceExists: boolean
  sizeBytes: number | null
  /** Arquivos do MinIO no backup; `null` em backup só de banco. */
  files: { count: number; bytes: number } | null
  errorMessage: string | null
  /** Onde o arquivo está: MinIO local e/ou cópia offsite. */
  locations: { local: boolean; offsite: boolean }
  offsiteCopiedAt: string | null
  triggeredBy: 'admin' | 'system'
  startedAt: string
  completedAt: string | null
  expiresAt: string | null
}

export interface AdminBackupListDTO {
  backups: AdminBackupDTO[]
  /** `BACKUP_OFFSITE_*` configurado (há cópia fora do servidor). */
  offsiteConfigured: boolean
}

export interface AdminBackupDownloadLinkDTO {
  url: string
  expiresAt: string
}

export interface AdminAuditEntryDTO {
  id: string
  actorEmail: string
  action: string
  targetType: string
  targetId: string | null
  targetLabel: string | null
  reason: string | null
  failed: boolean
  createdAt: string
}

export interface QueueHealthDTO {
  name: string
  waiting: number
  active: number
  delayed: number
  failed: number
  completed: number
}

export interface AdminOverviewDTO {
  generatedAt: string
  workspaces: {
    total: number
    active: number
    suspended: number
    deleting: number
    trial: number
    createdLast30d: number
    createdPrev30d: number
  }
  users: { total: number; createdLast7d: number; createdPrev7d: number }
  mrr: { cents: number; payingWorkspaces: number }
  recentSignups: {
    id: string
    name: string
    email: string
    createdAt: string
  }[]
  recentActions: AdminAuditEntryDTO[]
  /** `null` quando o Redis das filas não respondeu. */
  queues: QueueHealthDTO[] | null
  status: {
    componentKey: string
    name: string
    status: ComponentStatus
    latencyMs: number
    checkedAt: string
  }[]
  recentBackups: AdminBackupDTO[]
  operations: AdminOperationDTO[]
}
