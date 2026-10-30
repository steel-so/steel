'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CrmDuplicateEntity,
  CrmDuplicatePageDTO,
  CrmDuplicateScanDTO,
  CrmDuplicateStatus,
  CrmMergeDTO,
} from '@/types/crm-duplicate'
import { apiFetch, apiFetchJson } from './_fetch'

/** Duplicate review queue, merge and undo (crm-ops C7). */

const base = (ws: string) =>
  `/api/workspaces/${encodeURIComponent(ws)}/crm/duplicates`

export const crmDuplicateKeys = {
  all: (ws: string) => ['crm-duplicates', ws] as const,
  list: (
    ws: string,
    entity: CrmDuplicateEntity,
    status: CrmDuplicateStatus,
    page: number,
  ) => ['crm-duplicates', ws, 'list', entity, status, page] as const,
  merges: (ws: string, entity: CrmDuplicateEntity) =>
    ['crm-duplicates', ws, 'merges', entity] as const,
}

export function useCrmDuplicates(
  workspaceId: string,
  entity: CrmDuplicateEntity,
  status: CrmDuplicateStatus,
  page: number,
) {
  return useQuery({
    queryKey: crmDuplicateKeys.list(workspaceId, entity, status, page),
    queryFn: () =>
      apiFetch<CrmDuplicatePageDTO>(
        `${base(workspaceId)}?entity=${entity}&status=${status}&page=${page}`,
        undefined,
        'Erro ao buscar os duplicados',
      ),
    enabled: Boolean(workspaceId),
  })
}

export function useCrmMerges(workspaceId: string, entity: CrmDuplicateEntity) {
  return useQuery({
    queryKey: crmDuplicateKeys.merges(workspaceId, entity),
    queryFn: () =>
      apiFetch<CrmMergeDTO[]>(
        `${base(workspaceId)}/merges?entity=${entity}`,
        undefined,
        'Erro ao buscar as mesclagens',
      ),
    enabled: Boolean(workspaceId),
  })
}

/** People, companies and the queue all change after a merge or an undo. */
function useRefresh(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: crmDuplicateKeys.all(workspaceId),
      }),
      queryClient.invalidateQueries({ queryKey: ['crm-people'] }),
      queryClient.invalidateQueries({ queryKey: ['crm-companies'] }),
    ])
}

export function useScanCrmDuplicates(workspaceId: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: (entity?: CrmDuplicateEntity) =>
      apiFetchJson<CrmDuplicateScanDTO>(
        `${base(workspaceId)}/scan`,
        'POST',
        entity ? { entity } : {},
        'Erro ao procurar duplicados',
      ),
    onSuccess: refresh,
  })
}

export function useMergeCrmDuplicate(workspaceId: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: ({
      candidateId,
      survivorId,
    }: {
      candidateId: string
      survivorId: string
    }) =>
      apiFetchJson<CrmMergeDTO>(
        `${base(workspaceId)}/${encodeURIComponent(candidateId)}/merge`,
        'POST',
        { survivorId },
        'Erro ao mesclar',
      ),
    onSuccess: refresh,
  })
}

export function useDismissCrmDuplicate(workspaceId: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: (candidateId: string) =>
      apiFetchJson<{ status: CrmDuplicateStatus }>(
        `${base(workspaceId)}/${encodeURIComponent(candidateId)}/dismiss`,
        'POST',
        undefined,
        'Erro ao descartar o par',
      ),
    onSuccess: refresh,
  })
}

export function useUndoCrmMerge(workspaceId: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: (mergeId: string) =>
      apiFetchJson<CrmMergeDTO>(
        `${base(workspaceId)}/merges/${encodeURIComponent(mergeId)}/undo`,
        'POST',
        undefined,
        'Erro ao desfazer a mesclagem',
      ),
    onSuccess: refresh,
  })
}
