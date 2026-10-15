import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateWhatsAppTeamInput,
  UpdateWhatsAppTeamInput,
} from '@/src/schemas/whatsapp-team.schema'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import type {
  WhatsAppConversationScopeDTO,
  WhatsAppTeamDTO,
} from '@/types/whatsapp-team'
import { apiFetch } from './_fetch'

export const WHATSAPP_TEAMS_KEY = (workspaceId: string) =>
  ['whatsapp-teams', workspaceId] as const

const SCOPE_KEY = (workspaceId: string) =>
  ['whatsapp-teams', workspaceId, 'me'] as const

/** Teams of the workspace (Equipes) — leaders first inside each team. */
export function useWhatsAppTeams(workspaceId: string) {
  return useQuery({
    queryKey: WHATSAPP_TEAMS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppTeamDTO[]>(
        `/api/workspaces/${workspaceId}/whatsapp/teams`,
        undefined,
        'Erro ao buscar equipes',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

/** How the current user sees conversations (`ALL` or `SCOPED`). */
export function useWhatsAppConversationScope(workspaceId: string) {
  return useQuery({
    queryKey: SCOPE_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppConversationScopeDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/teams/me`,
        undefined,
        'Erro ao buscar seu escopo de conversas',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

/** Team edits change who sees what: refresh teams, scope and the inbox. */
function useInvalidateTeams(workspaceId: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['whatsapp-teams', workspaceId] })
    queryClient.invalidateQueries({
      queryKey: ['whatsapp-conversations', workspaceId],
    })
  }
}

export function useCreateWhatsAppTeam(workspaceId: string) {
  const invalidate = useInvalidateTeams(workspaceId)
  return useMutation({
    mutationFn: (data: CreateWhatsAppTeamInput) =>
      apiFetch<WhatsAppTeamDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/teams`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao criar equipe',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateWhatsAppTeam(workspaceId: string) {
  const invalidate = useInvalidateTeams(workspaceId)
  return useMutation({
    mutationFn: ({
      teamId,
      ...data
    }: UpdateWhatsAppTeamInput & { teamId: string }) =>
      apiFetch<WhatsAppTeamDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/teams/${teamId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao atualizar equipe',
      ),
    onSuccess: invalidate,
  })
}

export function useDeleteWhatsAppTeam(workspaceId: string) {
  const invalidate = useInvalidateTeams(workspaceId)
  return useMutation({
    mutationFn: (teamId: string) =>
      apiFetch<{ id: string }>(
        `/api/workspaces/${workspaceId}/whatsapp/teams/${teamId}`,
        { method: 'DELETE' },
        'Erro ao excluir equipe',
      ),
    onSuccess: invalidate,
  })
}

/** Moves a conversation to a team (`null` removes it). */
export function useSetWhatsAppConversationTeam(
  workspaceId: string,
  conversationId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (teamId: string | null) =>
      apiFetch<WhatsAppConversationDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/team`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamId }),
        },
        'Erro ao mover a conversa de equipe',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-conversations', workspaceId],
      })
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-conversation-events', workspaceId, conversationId],
      })
    },
  })
}
