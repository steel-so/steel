'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ConnectSdRemoteDTO,
  UpdateSdRemoteSettingsDTO,
  UpsertSdRemoteEndpointDTO,
} from '@/src/schemas/sd-remote.schema'
import type {
  SdRemoteConnectDTO,
  SdRemoteEndpointDTO,
  SdRemoteSessionDTO,
  SdRemoteSettingsDTO,
} from '@/types/sd-remote'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'
import { sdBase, sdQueryString } from './_sd-directory'

/** Acesso remoto integrado (S4). Tudo sob `['sd-remote', workspaceId]`. */

export const sdRemoteKeys = {
  all: (workspaceId: string) => ['sd-remote', workspaceId] as const,
}

const path = (suffix: string) => `remote/${suffix}`

function useInvalidate(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({ queryKey: sdRemoteKeys.all(workspaceId) })
}

export function useSdRemoteSettings(workspaceId: string) {
  return useQuery({
    queryKey: [...sdRemoteKeys.all(workspaceId), 'settings'],
    queryFn: () =>
      apiFetch<SdRemoteSettingsDTO>(
        sdBase(workspaceId, path('settings')),
        undefined,
        'Erro ao carregar os ajustes de acesso remoto',
      ),
    enabled: !!workspaceId,
  })
}

export function useSdRemoteSettingsMutation(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (data: UpdateSdRemoteSettingsDTO) =>
      apiFetchJson<SdRemoteSettingsDTO>(
        sdBase(workspaceId, path('settings')),
        'PATCH',
        data,
        'Erro ao salvar os ajustes de acesso remoto',
      ),
    onSuccess: invalidate,
  })
}

export function useSdRemoteEndpoints(
  workspaceId: string,
  configItemId: string | null | undefined,
) {
  return useQuery({
    queryKey: [...sdRemoteKeys.all(workspaceId), 'endpoints', configItemId],
    queryFn: () =>
      apiFetch<SdRemoteEndpointDTO[]>(
        `${sdBase(workspaceId, path('endpoints'))}${sdQueryString({ configItemId })}`,
        undefined,
        'Erro ao carregar o acesso remoto do ativo',
      ),
    enabled: !!workspaceId && !!configItemId,
  })
}

export function useSdRemoteEndpointMutations(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return {
    save: useMutation({
      mutationFn: (data: UpsertSdRemoteEndpointDTO) =>
        apiFetchJson<SdRemoteEndpointDTO>(
          sdBase(workspaceId, path('endpoints')),
          'PUT',
          data,
          'Erro ao salvar o ID de acesso remoto',
        ),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (endpointId: string) =>
        apiSend(
          sdBase(workspaceId, path(`endpoints/${endpointId}`)),
          { method: 'DELETE' },
          'Erro ao remover o ID de acesso remoto',
        ),
      onSuccess: invalidate,
    }),
  }
}

export function useSdRemoteSessions(
  workspaceId: string,
  configItemId: string | null | undefined,
) {
  return useQuery({
    queryKey: [...sdRemoteKeys.all(workspaceId), 'sessions', configItemId],
    queryFn: () =>
      apiFetch<SdRemoteSessionDTO[]>(
        `${sdBase(workspaceId, path('sessions'))}${sdQueryString({ configItemId })}`,
        undefined,
        'Erro ao carregar as sessões remotas',
      ),
    enabled: !!workspaceId && !!configItemId,
  })
}

/** "Conectar": devolve o link a abrir; o histórico do chamado é atualizado pelo servidor. */
export function useSdRemoteConnect(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: ConnectSdRemoteDTO) =>
      apiFetchJson<SdRemoteConnectDTO>(
        sdBase(workspaceId, path('connect')),
        'POST',
        data,
        'Não foi possível iniciar o acesso remoto',
      ),
    onSuccess: () => {
      void invalidate()
      void queryClient.invalidateQueries({
        queryKey: ['sd-tickets', workspaceId],
      })
    },
  })
}
