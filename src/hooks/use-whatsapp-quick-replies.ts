import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WhatsAppButtonDTO } from '@/types/whatsapp-button'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import type { WhatsAppQuickReplyDTO } from '@/types/whatsapp-quick-reply'
import { apiFetch, apiSend } from './_fetch'

const QUICK_REPLIES_KEY = (workspaceId: string) =>
  ['whatsapp-quick-replies', workspaceId] as const

interface QuickReplyInput {
  shortcut: string
  title: string
  body: string
  mediaUrl?: string
  buttons?: WhatsAppButtonDTO[]
}

/** On update `buttons: null` removes them. */
type QuickReplyUpdateInput = Partial<Omit<QuickReplyInput, 'buttons'>> & {
  buttons?: WhatsAppButtonDTO[] | null
}

export function useWhatsAppQuickReplies(workspaceId: string) {
  return useQuery({
    queryKey: QUICK_REPLIES_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppQuickReplyDTO[]>(
        `/api/workspaces/${workspaceId}/whatsapp/quick-replies`,
        undefined,
        'Erro ao buscar mensagens rápidas',
      ),
    staleTime: 60 * 1000,
  })
}

export function useCreateWhatsAppQuickReply(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: QuickReplyInput) =>
      apiFetch<WhatsAppQuickReplyDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/quick-replies`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao criar mensagem rápida',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: QUICK_REPLIES_KEY(workspaceId),
      })
    },
  })
}

export function useUpdateWhatsAppQuickReply(
  workspaceId: string,
  quickReplyId: string,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: QuickReplyUpdateInput) =>
      apiFetch<WhatsAppQuickReplyDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/quick-replies/${quickReplyId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao atualizar mensagem rápida',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: QUICK_REPLIES_KEY(workspaceId),
      })
    },
  })
}

export function useDeleteWhatsAppQuickReply(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (quickReplyId: string) =>
      apiSend(
        `/api/workspaces/${workspaceId}/whatsapp/quick-replies/${quickReplyId}`,
        { method: 'DELETE' },
        'Erro ao remover mensagem rápida',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: QUICK_REPLIES_KEY(workspaceId),
      })
    },
  })
}

interface SendWhatsAppQuickReplyInput {
  quickReplyId: string
  /** Values for the `{token}` variables of the body (`nome_cliente`…). */
  variables?: Record<string, string>
}

/** Sends a quick reply as-is (body, media and buttons) through the provider —
 * the way to send one that has buttons, which a plain text send would drop. */
export function useSendWhatsAppQuickReply(
  workspaceId: string,
  conversationId: string,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: SendWhatsAppQuickReplyInput) =>
      apiFetch<WhatsAppMessageDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/messages/quick-reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao enviar mensagem rápida',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-messages', workspaceId, conversationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-conversations', workspaceId],
      })
    },
  })
}
