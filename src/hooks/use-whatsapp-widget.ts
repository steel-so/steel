import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateWhatsAppWidgetSettingsDTO } from '@/src/schemas/whatsapp-widget.schema'
import type { WhatsAppWidgetSettingsDTO } from '@/types/whatsapp-widget'
import { apiFetch, apiFetchJson } from './_fetch'

const SETTINGS_KEY = (workspaceId: string) =>
  ['whatsapp-widget-settings', workspaceId] as const

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/widget`

/** Site chat widget settings (OWNER/ADMIN). */
export function useWhatsAppWidgetSettings(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: SETTINGS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppWidgetSettingsDTO>(
        base(workspaceId),
        undefined,
        'Erro ao buscar as configurações do chat do site',
      ),
    enabled: enabled && Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

export function useUpdateWhatsAppWidgetSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateWhatsAppWidgetSettingsDTO) =>
      apiFetchJson<WhatsAppWidgetSettingsDTO>(
        base(workspaceId),
        'PATCH',
        data,
        'Erro ao salvar as configurações do chat do site',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY(workspaceId), data)
    },
  })
}

/** New public key: snippets already on sites stop working. */
export function useRotateWhatsAppWidgetKey(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetchJson<WhatsAppWidgetSettingsDTO>(
        `${base(workspaceId)}/rotate-key`,
        'POST',
        {},
        'Erro ao gerar uma nova chave',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY(workspaceId), data)
    },
  })
}
