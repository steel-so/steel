import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WhatsAppConnectionDTO } from '@/types/whatsapp-connection'
import type {
  MetaChannelConnectionDTO,
  WhatsAppCoexistenceSyncDTO,
  WhatsAppMetaChannelSettingsDTO,
} from '@/types/whatsapp-meta-channel'
import { apiFetch } from './_fetch'

const SETTINGS_KEY = (workspaceId: string) =>
  ['whatsapp-meta-channel-settings', workspaceId] as const
const CONNECTIONS_KEY = (workspaceId: string) =>
  ['whatsapp-meta-channel-connections', workspaceId] as const
const SYNC_KEY = (workspaceId: string, connectionId: string) =>
  ['whatsapp-coexistence-sync', workspaceId, connectionId] as const

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
        'Erro ao buscar as configurações da Coexistência',
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
        'Erro ao salvar as configurações da Coexistência',
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
        'Erro ao buscar os números em Coexistência',
      ),
    enabled,
    staleTime: 60 * 1000,
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
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY(workspaceId) })
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
