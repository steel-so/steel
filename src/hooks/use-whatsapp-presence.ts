import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  WhatsAppPresenceDTO,
  WhatsAppPresenceStatusDTO,
} from '@/types/whatsapp-presence'
import { apiFetch } from './_fetch'

export const WHATSAPP_PRESENCE_ME_KEY = (workspaceId: string) =>
  ['whatsapp-presence', workspaceId, 'me'] as const

export const WHATSAPP_PRESENCE_TEAM_KEY = (workspaceId: string) =>
  ['whatsapp-presence', workspaceId, 'team'] as const

/** The signed-in agent's own presence (Disponível when never set). */
export function useMyWhatsAppPresence(workspaceId: string) {
  return useQuery({
    queryKey: WHATSAPP_PRESENCE_ME_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppPresenceDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/presence/me`,
        undefined,
        'Erro ao buscar sua presença',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

/** Flips the toggle at once and rolls back when the server refuses. */
export function useSetMyWhatsAppPresence(workspaceId: string) {
  const queryClient = useQueryClient()
  const key = WHATSAPP_PRESENCE_ME_KEY(workspaceId)

  return useMutation({
    mutationFn: (status: WhatsAppPresenceStatusDTO) =>
      apiFetch<WhatsAppPresenceDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/presence/me`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
        'Erro ao atualizar sua presença',
      ),
    onMutate: async (status) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<WhatsAppPresenceDTO>(key)
      if (previous) queryClient.setQueryData(key, { ...previous, status })
      return { previous }
    },
    onError: (_error, _status, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSuccess: (data) => {
      queryClient.setQueryData(key, data)
      queryClient.invalidateQueries({
        queryKey: WHATSAPP_PRESENCE_TEAM_KEY(workspaceId),
      })
    },
  })
}

/**
 * Presence of the team members, for admins and team leaders. Polled every
 * 30 s: presence is advisory, no live stream needed.
 */
export function useWhatsAppTeamPresence(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: WHATSAPP_PRESENCE_TEAM_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppPresenceDTO[]>(
        `/api/workspaces/${workspaceId}/whatsapp/presence`,
        undefined,
        'Erro ao buscar a presença da equipe',
      ),
    enabled: Boolean(workspaceId) && enabled,
    refetchInterval: 30 * 1000,
    staleTime: 15 * 1000,
  })
}
