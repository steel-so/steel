'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AdminAuditEntryDTO,
  AdminBackupDownloadLinkDTO,
  AdminBackupListDTO,
  AdminOperationDTO,
  AdminWorkspaceDetailDTO,
} from '@/types/admin-workspace'
import { apiFetch } from './_fetch'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export const adminKeys = {
  backups: (filters: BackupFilters) => ['admin', 'backups', filters] as const,
  operations: (workspaceId?: string) =>
    ['admin', 'operations', workspaceId ?? 'all'] as const,
  audit: (workspaceId: string) => ['admin', 'audit', workspaceId] as const,
}

export interface BackupFilters {
  scope?: 'FULL' | 'WORKSPACE'
  workspaceId?: string
}

const isActive = (op: AdminOperationDTO) =>
  op.status === 'QUEUED' || op.status === 'RUNNING'

/** Backups; faz polling enquanto houver backup em andamento. */
export function useAdminBackups(filters: BackupFilters = {}) {
  const params = new URLSearchParams()
  if (filters.scope) params.set('scope', filters.scope)
  if (filters.workspaceId) params.set('workspaceId', filters.workspaceId)
  const qs = params.toString()

  return useQuery({
    queryKey: adminKeys.backups(filters),
    queryFn: () =>
      apiFetch<AdminBackupListDTO>(
        `/api/admin/backups${qs ? `?${qs}` : ''}`,
        undefined,
        'Erro ao carregar os backups',
      ),
    refetchInterval: (query) =>
      query.state.data?.backups.some((b) => b.status === 'RUNNING')
        ? 4000
        : false,
  })
}

/** Exclusões/restaurações; polling a cada 3 s enquanto alguma estiver ativa. */
export function useAdminOperations(workspaceId?: string) {
  return useQuery({
    queryKey: adminKeys.operations(workspaceId),
    queryFn: () =>
      apiFetch<AdminOperationDTO[]>(
        `/api/admin/operations${workspaceId ? `?workspaceId=${workspaceId}` : ''}`,
        undefined,
        'Erro ao carregar as operações',
      ),
    refetchInterval: (query) =>
      query.state.data?.some(isActive) ? 3000 : false,
  })
}

export function useAdminWorkspaceAudit(workspaceId: string) {
  return useQuery({
    queryKey: adminKeys.audit(workspaceId),
    queryFn: () =>
      apiFetch<AdminAuditEntryDTO[]>(
        `/api/admin/workspaces/${workspaceId}/audit`,
        undefined,
        'Erro ao carregar o histórico',
      ),
  })
}

function useInvalidateAdmin() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ['admin'] })
}

export function useTriggerBackup() {
  const invalidate = useInvalidateAdmin()
  return useMutation({
    mutationFn: (
      input: { scope: 'FULL' } | { scope: 'WORKSPACE'; workspaceId: string },
    ) =>
      apiFetch<{ jobId: string }>(
        '/api/admin/backups',
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) },
        'Não foi possível disparar o backup',
      ),
    onSuccess: invalidate,
  })
}

/** Gera o link assinado e dispara o download no navegador. */
export function useDownloadBackup() {
  return useMutation({
    mutationFn: async (backupId: string) => {
      const link = await apiFetch<AdminBackupDownloadLinkDTO>(
        `/api/admin/backups/${backupId}/download-link`,
        { method: 'POST' },
        'Não foi possível gerar o link de download',
      )
      window.location.assign(link.url)
      return link
    },
  })
}

export interface ConfirmedActionInput {
  confirmSlug: string
  reason: string
}

/**
 * Exclusão de workspace. `ignoreSubscriptionCancelFailure` é o *force*: por
 * padrão uma falha ao cancelar a assinatura no AbacatePay barra a exclusão.
 */
export interface DeleteWorkspaceActionInput extends ConfirmedActionInput {
  ignoreSubscriptionCancelFailure: boolean
}

export function useRestoreBackup() {
  const invalidate = useInvalidateAdmin()
  return useMutation({
    mutationFn: ({
      backupId,
      ...input
    }: ConfirmedActionInput & { backupId: string }) =>
      apiFetch<AdminOperationDTO>(
        `/api/admin/backups/${backupId}/restore`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) },
        'Não foi possível iniciar a restauração',
      ),
    onSuccess: invalidate,
  })
}

export function useSetWorkspaceStatus(workspaceId: string) {
  const invalidate = useInvalidateAdmin()
  return useMutation({
    mutationFn: (input: { action: 'suspend' | 'reactivate'; reason: string }) =>
      apiFetch<AdminWorkspaceDetailDTO>(
        `/api/admin/workspaces/${workspaceId}/status`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(input) },
        'Não foi possível alterar o status',
      ),
    onSuccess: invalidate,
  })
}

export function useChangeWorkspacePlan(workspaceId: string) {
  const invalidate = useInvalidateAdmin()
  return useMutation({
    mutationFn: (input: { plan: string; reason: string }) =>
      apiFetch<AdminWorkspaceDetailDTO>(
        `/api/admin/workspaces/${workspaceId}/plan`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(input) },
        'Não foi possível alterar o plano',
      ),
    onSuccess: invalidate,
  })
}

export function useSetWorkspaceAllowedIps(workspaceId: string) {
  const invalidate = useInvalidateAdmin()
  return useMutation({
    mutationFn: (input: { allowedIps: string[]; reason: string }) =>
      apiFetch<AdminWorkspaceDetailDTO>(
        `/api/admin/workspaces/${workspaceId}/allowed-ips`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(input) },
        'Não foi possível salvar os IPs permitidos',
      ),
    onSuccess: invalidate,
  })
}

export function useDeleteWorkspace(workspaceId: string) {
  const invalidate = useInvalidateAdmin()
  return useMutation({
    mutationFn: (input: DeleteWorkspaceActionInput) =>
      apiFetch<AdminOperationDTO>(
        `/api/admin/workspaces/${workspaceId}/deletion`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) },
        'Não foi possível pedir a exclusão',
      ),
    onSuccess: invalidate,
  })
}
