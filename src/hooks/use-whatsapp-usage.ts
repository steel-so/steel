import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WhatsAppUsageDTO } from '@/types/whatsapp-usage'
import { apiFetch } from './_fetch'

export const WHATSAPP_USAGE_KEY = (workspaceId: string) =>
  ['whatsapp-usage', workspaceId] as const

export interface UpdateWhatsAppUsageLimitsInput {
  /** `null` = unlimited. */
  monthlyConversationLimit?: number | null
  monthlyMessageLimit?: number | null
}

export function useWhatsAppUsage(workspaceId: string) {
  return useQuery({
    queryKey: WHATSAPP_USAGE_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppUsageDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/usage`,
        undefined,
        'Erro ao buscar o consumo da Comunicação',
      ),
    staleTime: 30 * 1000,
  })
}

export function useUpdateWhatsAppUsageLimits(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: UpdateWhatsAppUsageLimitsInput) =>
      apiFetch<WhatsAppUsageDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/usage`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao salvar os limites da Comunicação',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(WHATSAPP_USAGE_KEY(workspaceId), data)
    },
  })
}
