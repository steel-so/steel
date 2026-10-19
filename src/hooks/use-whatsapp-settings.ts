import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WhatsAppSettingsDTO } from '@/types/whatsapp-settings'
import { apiFetch } from './_fetch'

const SETTINGS_KEY = (workspaceId: string) =>
  ['whatsapp-settings', workspaceId] as const

export type UpdateWhatsAppSettingsInput = Partial<
  Omit<WhatsAppSettingsDTO, 'workspaceId' | 'callRecordingNotice'>
> & {
  /** `null` (or empty) goes back to the default notice. */
  callRecordingNotice?: string | null
}

export function useWhatsAppSettings(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: SETTINGS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppSettingsDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/settings`,
        undefined,
        'Erro ao buscar configurações de atendimento',
      ),
    enabled,
    staleTime: 60 * 1000,
  })
}

export function useUpdateWhatsAppSettings(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: UpdateWhatsAppSettingsInput) =>
      apiFetch<WhatsAppSettingsDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/settings`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao salvar configurações de atendimento',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY(workspaceId), data)
    },
  })
}
