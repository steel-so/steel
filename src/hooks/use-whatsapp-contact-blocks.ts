import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  WhatsAppContactBlockDTO,
  WhatsAppContactBlockResultDTO,
  WhatsAppContactBlockSyncDTO,
  WhatsAppContactUnblockResultDTO,
  WhatsAppConversationBlockStateDTO,
} from '@/types/whatsapp-contact-block'
import { apiFetch, apiFetchJson } from './_fetch'

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/blocks`

export const WHATSAPP_CONTACT_BLOCKS_KEY = (workspaceId: string) =>
  ['whatsapp-contact-blocks', workspaceId] as const

export const WHATSAPP_CONVERSATION_BLOCK_KEY = (
  workspaceId: string,
  conversationId: string,
) => ['whatsapp-conversation-block', workspaceId, conversationId] as const

/** Everything that shows a block: the list, the banners, the badges. */
function invalidateBlocks(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
) {
  queryClient.invalidateQueries({
    queryKey: WHATSAPP_CONTACT_BLOCKS_KEY(workspaceId),
  })
  queryClient.invalidateQueries({
    queryKey: ['whatsapp-conversation-block', workspaceId],
  })
  queryClient.invalidateQueries({
    queryKey: ['whatsapp-contacts', workspaceId],
  })
}

/** Settings › Contatos bloqueados (OWNER/ADMIN and team leaders). */
export function useWhatsAppContactBlocks(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: WHATSAPP_CONTACT_BLOCKS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppContactBlockDTO[]>(
        base(workspaceId),
        undefined,
        'Erro ao buscar os contatos bloqueados',
      ),
    enabled,
    retry: false,
  })
}

/** Inbox: block state of the conversation's contact on its number. */
export function useWhatsAppConversationBlock(
  workspaceId: string,
  conversationId: string,
) {
  return useQuery({
    queryKey: WHATSAPP_CONVERSATION_BLOCK_KEY(workspaceId, conversationId),
    queryFn: () =>
      apiFetch<WhatsAppConversationBlockStateDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/block`,
        undefined,
        'Erro ao verificar o bloqueio do contato',
      ),
    staleTime: 30 * 1000,
    retry: false,
  })
}

export interface BlockWhatsAppContactInput {
  conversationId?: string
  connectionId?: string
  contactId?: string
  reason?: string | null
}

export function useBlockWhatsAppContact(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: BlockWhatsAppContactInput) =>
      apiFetchJson<WhatsAppContactBlockResultDTO>(
        base(workspaceId),
        'POST',
        input,
        'Erro ao bloquear o contato',
      ),
    onSuccess: () => invalidateBlocks(queryClient, workspaceId),
  })
}

export function useUnblockWhatsAppContact(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (blockId: string) =>
      apiFetch<WhatsAppContactUnblockResultDTO>(
        `${base(workspaceId)}/${blockId}`,
        { method: 'DELETE' },
        'Erro ao desbloquear o contato',
      ),
    onSuccess: () => invalidateBlocks(queryClient, workspaceId),
  })
}

export function useSyncWhatsAppContactBlocks(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (connectionId?: string) =>
      apiFetchJson<WhatsAppContactBlockSyncDTO>(
        `${base(workspaceId)}/sync`,
        'POST',
        connectionId ? { connectionId } : {},
        'Erro ao sincronizar os bloqueios',
      ),
    onSuccess: () => invalidateBlocks(queryClient, workspaceId),
  })
}
