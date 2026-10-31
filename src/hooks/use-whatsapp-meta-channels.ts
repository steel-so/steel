import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WhatsAppConnectionDTO } from '@/types/whatsapp-connection'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import type {
  MetaChannelConnectionDTO,
  MetaChannelPageDTO,
  WhatsAppCoexistenceSyncDTO,
  WhatsAppMetaChannelSettingsDTO,
  WhatsAppSocialCommentDTO,
} from '@/types/whatsapp-meta-channel'
import { apiFetch } from './_fetch'

const SETTINGS_KEY = (workspaceId: string) =>
  ['whatsapp-meta-channel-settings', workspaceId] as const
const CONNECTIONS_KEY = (workspaceId: string) =>
  ['whatsapp-meta-channel-connections', workspaceId] as const
const SYNC_KEY = (workspaceId: string, connectionId: string) =>
  ['whatsapp-coexistence-sync', workspaceId, connectionId] as const
const COMMENTS_KEY = (workspaceId: string, conversationId: string) =>
  ['whatsapp-social-comments', workspaceId, conversationId] as const

const BASE = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/meta-channels`

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export type UpdateMetaChannelSettingsInput = Partial<
  Omit<WhatsAppMetaChannelSettingsDTO, 'workspaceId'>
>

export function useMetaChannelSettings(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: SETTINGS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppMetaChannelSettingsDTO>(
        `${BASE(workspaceId)}/settings`,
        undefined,
        'Erro ao buscar as chaves dos canais da Meta',
      ),
    enabled,
    staleTime: 60 * 1000,
  })
}

export function useUpdateMetaChannelSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateMetaChannelSettingsInput) =>
      apiFetch<WhatsAppMetaChannelSettingsDTO>(
        `${BASE(workspaceId)}/settings`,
        json('PATCH', data),
        'Erro ao salvar as chaves dos canais da Meta',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY(workspaceId), data)
    },
  })
}

export function useMetaChannelConnections(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: CONNECTIONS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<MetaChannelConnectionDTO[]>(
        `${BASE(workspaceId)}/connections`,
        undefined,
        'Erro ao buscar as conexões de Instagram e Messenger',
      ),
    enabled,
    staleTime: 60 * 1000,
  })
}

/** Step 1 of the connect dialog: the Pages the Meta user manages. */
export function useListMetaChannelPages(workspaceId: string) {
  return useMutation({
    mutationFn: (data: { accessToken: string }) =>
      apiFetch<MetaChannelPageDTO[]>(
        `${BASE(workspaceId)}/pages`,
        json('POST', data),
        'Erro ao buscar as Páginas da Meta',
      ),
  })
}

export interface ConnectMetaChannelInput {
  accessToken: string
  pageId: string
  channels: ('MESSENGER' | 'INSTAGRAM')[]
}

export function useConnectMetaChannel(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: ConnectMetaChannelInput) =>
      apiFetch<MetaChannelConnectionDTO[]>(
        `${BASE(workspaceId)}/connect`,
        json('POST', data),
        'Erro ao conectar a Página',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY(workspaceId) })
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-connections', workspaceId],
      })
    },
  })
}

export interface ConnectCoexistenceInput {
  code: string
  phoneNumberId: string
  wabaId: string
  label?: string
}

export function useConnectWhatsAppCoexistence(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: ConnectCoexistenceInput) =>
      apiFetch<{
        connection: WhatsAppConnectionDTO
        sync: WhatsAppCoexistenceSyncDTO
      }>(
        `/api/workspaces/${workspaceId}/whatsapp/connections/coexistence`,
        json('POST', data),
        'Erro ao conectar o número em Coexistência',
      ),
    onSuccess: ({ connection, sync }) => {
      queryClient.setQueryData(SYNC_KEY(workspaceId, connection.id), sync)
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-connections', workspaceId],
      })
    },
  })
}

/** Import progress; polls while Meta is still delivering the history. */
export function useWhatsAppCoexistenceSync(
  workspaceId: string,
  connectionId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: SYNC_KEY(workspaceId, connectionId),
    queryFn: () =>
      apiFetch<WhatsAppCoexistenceSyncDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/connections/${connectionId}/coexistence`,
        undefined,
        'Erro ao buscar o andamento da importação',
      ),
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'PENDING' || status === 'SYNCING' ? 5000 : false
    },
  })
}

export function useWhatsAppSocialComments(
  workspaceId: string,
  conversationId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: COMMENTS_KEY(workspaceId, conversationId),
    queryFn: () =>
      apiFetch<WhatsAppSocialCommentDTO[]>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/social-comments`,
        undefined,
        'Erro ao buscar os comentários da conversa',
      ),
    enabled,
    staleTime: 30 * 1000,
  })
}

export function useReplyWhatsAppSocialComment(
  workspaceId: string,
  conversationId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      messageId: string
      text: string
      mode: 'PUBLIC' | 'PRIVATE'
    }) =>
      apiFetch<WhatsAppMessageDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/social-comments/${input.messageId}/reply`,
        json('POST', { text: input.text, mode: input.mode }),
        'Erro ao responder o comentário',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: COMMENTS_KEY(workspaceId, conversationId),
      })
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-messages', workspaceId, conversationId],
      })
    },
  })
}
