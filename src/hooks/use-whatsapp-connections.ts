import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WhatsAppConnectionDTO } from '@/types/whatsapp-connection'
import { apiFetch, apiSend } from './_fetch'

const CONNECTIONS_KEY = (workspaceId: string) =>
  ['whatsapp-connections', workspaceId] as const

type CreateWhatsAppConnectionInput =
  | {
      provider: 'ZAPI'
      label: string
      phoneNumber: string
      zapiInstanceId: string
      zapiToken: string
      zapiClientToken?: string
    }
  | {
      provider: 'META'
      label: string
      phoneNumber: string
      metaPhoneNumberId: string
      metaWabaId: string
      metaAccessToken: string
    }

interface UpdateWhatsAppConnectionInput {
  label?: string
  zapiToken?: string
  zapiClientToken?: string
  metaAccessToken?: string
}

export function useWhatsAppConnections(workspaceId: string) {
  return useQuery({
    queryKey: CONNECTIONS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppConnectionDTO[]>(
        `/api/workspaces/${workspaceId}/whatsapp/connections`,
        undefined,
        'Erro ao buscar conexões do WhatsApp',
      ),
    staleTime: 60 * 1000,
  })
}

export function useCreateWhatsAppConnection(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateWhatsAppConnectionInput) =>
      apiFetch<WhatsAppConnectionDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/connections`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao criar conexão do WhatsApp',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY(workspaceId) })
    },
  })
}

export function useUpdateWhatsAppConnection(
  workspaceId: string,
  connectionId: string,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: UpdateWhatsAppConnectionInput) =>
      apiFetch<WhatsAppConnectionDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/connections/${connectionId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao atualizar conexão do WhatsApp',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY(workspaceId) })
    },
  })
}

export function useDeleteWhatsAppConnection(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (connectionId: string) =>
      apiSend(
        `/api/workspaces/${workspaceId}/whatsapp/connections/${connectionId}`,
        { method: 'DELETE' },
        'Erro ao remover conexão do WhatsApp',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY(workspaceId) })
    },
  })
}

export function useWhatsAppConnectionQrCode(
  workspaceId: string,
  connectionId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['whatsapp-connection-qr-code', workspaceId, connectionId],
    queryFn: () =>
      apiFetch<{ status: string; qrCodeBase64?: string }>(
        `/api/workspaces/${workspaceId}/whatsapp/connections/${connectionId}/qr-code`,
        undefined,
        'Erro ao buscar QR code',
      ),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.status === 'connected' ? false : 4000,
  })
}

export interface MetaEmbeddedSignupInput {
  code: string
  phoneNumberId: string
  wabaId: string
  label?: string
}

export function useConnectWhatsAppViaMeta(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: MetaEmbeddedSignupInput) =>
      apiFetch<WhatsAppConnectionDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/connections/embedded-signup`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao conectar o número pela Meta',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY(workspaceId) })
    },
  })
}

export function useRefreshWhatsAppConnectionStatus(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (connectionId: string) =>
      apiFetch<WhatsAppConnectionDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/connections/${connectionId}/status`,
        { method: 'POST' },
        'Erro ao verificar o status da conexão',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY(workspaceId) })
    },
  })
}
