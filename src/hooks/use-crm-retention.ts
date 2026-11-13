import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateCrmRetentionSettingsDTO } from '@/src/schemas/crm-retention.schema'
import type { CrmRetentionSettingsDTO } from '@/types/crm-retention'
import { apiFetch } from './_fetch'

export function crmRetentionKey(workspaceId: string) {
  return ['crm-retention', workspaceId] as const
}

/** Retention follow-up rules (defaults while the workspace never saved). */
export function useCrmRetentionSettings(workspaceId: string) {
  return useQuery({
    queryKey: crmRetentionKey(workspaceId),
    queryFn: () =>
      apiFetch<CrmRetentionSettingsDTO>(
        `/api/workspaces/${workspaceId}/crm/retention`,
        undefined,
        'Erro ao carregar as regras de retenção',
      ),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  })
}

export function useUpdateCrmRetentionSettings(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: UpdateCrmRetentionSettingsDTO) =>
      apiFetch<CrmRetentionSettingsDTO>(
        `/api/workspaces/${workspaceId}/crm/retention`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao salvar as regras de retenção',
      ),
    onSuccess: (settings) => {
      queryClient.setQueryData(crmRetentionKey(workspaceId), settings)
    },
  })
}
