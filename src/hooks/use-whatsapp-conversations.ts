import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  StartWhatsAppPhoneCallDTO,
  WhatsAppPhoneCallDTO,
} from '@/src/schemas/whatsapp-phone-call.schema'
import type {
  WhatsAppAssignableMemberDTO,
  WhatsAppConversationDTO,
  WhatsAppConversationEventDTO,
  WhatsAppConversationStatusDTO,
} from '@/types/whatsapp-conversation'
import { apiFetch } from './_fetch'

const CONVERSATIONS_KEY = (
  workspaceId: string,
  status?: string,
  archived?: boolean,
  connectionId?: string,
) =>
  [
    'whatsapp-conversations',
    workspaceId,
    status ?? '',
    archived ?? false,
    connectionId ?? '',
  ] as const

/** `OPEN` = não fechadas (caixa de entrada ativa). */
export type WhatsAppConversationListStatus =
  | WhatsAppConversationStatusDTO
  | 'OPEN'

export function useWhatsAppConversations(
  workspaceId: string,
  status?: WhatsAppConversationListStatus,
  archived?: boolean,
  connectionId?: string,
) {
  return useQuery({
    queryKey: CONVERSATIONS_KEY(workspaceId, status, archived, connectionId),
    queryFn: () => {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (archived) params.set('archived', 'true')
      if (connectionId) params.set('connectionId', connectionId)
      const qs = params.toString()
      return apiFetch<WhatsAppConversationDTO[]>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations${qs ? `?${qs}` : ''}`,
        undefined,
        'Erro ao buscar conversas',
      )
    },
    staleTime: 15 * 1000,
  })
}

export function useStartWhatsAppConversation(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { contactId: string; connectionId: string }) =>
      apiFetch<WhatsAppConversationDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao iniciar conversa',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-conversations', workspaceId],
      })
    },
  })
}

export function useMarkWhatsAppConversationRead(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<WhatsAppConversationDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/read`,
        { method: 'POST' },
        'Erro ao marcar conversa como lida',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-conversations', workspaceId],
      })
    },
  })
}

export function useRemoveWhatsAppConversationFromAi(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<WhatsAppConversationDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/ai`,
        { method: 'PATCH' },
        'Erro ao remover conversa do atendimento da IA',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-conversations', workspaceId],
      })
    },
  })
}

export function useResumeWhatsAppConversationAi(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<WhatsAppConversationDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/ai/resume`,
        { method: 'PATCH' },
        'Erro ao retomar o atendimento da IA',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-conversations', workspaceId],
      })
    },
  })
}

function invalidateConversations(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
) {
  queryClient.invalidateQueries({
    queryKey: ['whatsapp-conversations', workspaceId],
  })
}

export function usePinWhatsAppConversation(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      conversationId,
      pinned,
    }: {
      conversationId: string
      pinned: boolean
    }) =>
      apiFetch<WhatsAppConversationDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/pin`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned }),
        },
        'Erro ao fixar conversa',
      ),
    onSuccess: () => invalidateConversations(queryClient, workspaceId),
  })
}

export function useArchiveWhatsAppConversation(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      conversationId,
      archived,
    }: {
      conversationId: string
      archived: boolean
    }) =>
      apiFetch<WhatsAppConversationDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/archive`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived }),
        },
        'Erro ao arquivar conversa',
      ),
    onSuccess: () => invalidateConversations(queryClient, workspaceId),
  })
}

export function useDeleteWhatsAppConversation(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<{ id: string }>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}`,
        { method: 'DELETE' },
        'Erro ao excluir conversa',
      ),
    onSuccess: () => invalidateConversations(queryClient, workspaceId),
  })
}

export function useClearWhatsAppChat(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<WhatsAppConversationDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/clear`,
        { method: 'POST' },
        'Erro ao limpar conversa',
      ),
    onSuccess: () => invalidateConversations(queryClient, workspaceId),
  })
}

export function useWhatsAppAssignableMembers(workspaceId: string) {
  return useQuery({
    queryKey: ['whatsapp-assignable-members', workspaceId],
    queryFn: () =>
      apiFetch<WhatsAppAssignableMemberDTO[]>(
        `/api/workspaces/${workspaceId}/whatsapp/assignable-members`,
        undefined,
        'Erro ao buscar membros do workspace',
      ),
    staleTime: 5 * 60 * 1000,
  })
}

export function useAssignWhatsAppConversation(
  workspaceId: string,
  conversationId: string,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (assignedUserId: string | null) =>
      apiFetch<WhatsAppConversationDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/assign`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignedUserId }),
        },
        'Erro ao transferir conversa',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-conversations', workspaceId],
      })
    },
  })
}

export const WHATSAPP_CONVERSATION_EVENTS_KEY = (
  workspaceId: string,
  conversationId: string,
) => ['whatsapp-conversation-events', workspaceId, conversationId] as const

export function useWhatsAppConversationEvents(
  workspaceId: string,
  conversationId: string,
) {
  return useQuery({
    queryKey: WHATSAPP_CONVERSATION_EVENTS_KEY(workspaceId, conversationId),
    queryFn: () =>
      apiFetch<WhatsAppConversationEventDTO[]>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/events`,
        undefined,
        'Erro ao buscar o histórico da conversa',
      ),
    staleTime: 15 * 1000,
  })
}

export function useCloseWhatsAppConversation(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { conversationId: string; reason?: string }) =>
      apiFetch<WhatsAppConversationDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${data.conversationId}/close`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: data.reason }),
        },
        'Erro ao fechar a conversa',
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-conversations', workspaceId],
      })
      queryClient.invalidateQueries({
        queryKey: WHATSAPP_CONVERSATION_EVENTS_KEY(
          workspaceId,
          variables.conversationId,
        ),
      })
    },
  })
}

export function useReopenWhatsAppConversation(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<WhatsAppConversationDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/reopen`,
        { method: 'POST' },
        'Erro ao reabrir a conversa',
      ),
    onSuccess: (_data, conversationId) => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-conversations', workspaceId],
      })
      queryClient.invalidateQueries({
        queryKey: WHATSAPP_CONVERSATION_EVENTS_KEY(workspaceId, conversationId),
      })
    },
  })
}

/** Click-to-call through the PABX: rings the user's extension, then the contact. */
export function useStartWhatsAppPhoneCall(workspaceId: string) {
  return useMutation({
    mutationFn: (data: {
      conversationId: string
      mode: StartWhatsAppPhoneCallDTO['mode']
    }) =>
      apiFetch<WhatsAppPhoneCallDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${data.conversationId}/call`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: data.mode }),
        },
        'Erro ao iniciar a ligação',
      ),
  })
}
