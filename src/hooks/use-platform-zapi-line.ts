'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  PlatformZapiLineDTO,
  PlatformZapiLineQrCodeDTO,
} from '@/types/platform-zapi-line'
import { apiFetch } from './_fetch'

export const platformZapiLineKey = ['admin', 'platform-zapi-line'] as const

const BASE = '/api/admin/zapi-line'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** Poll of the saved line while the screen is open. */
export const LINE_STATUS_POLL_MS = 30_000

/** Polling interval of the QR code while the phone has not scanned it. */
export const PLATFORM_LINE_QR_POLL_MS = 5000

/** Live status of the line, refreshed by the admin screen. */
export function usePlatformZapiLine(initial: PlatformZapiLineDTO) {
  return useQuery({
    queryKey: platformZapiLineKey,
    queryFn: () =>
      apiFetch<PlatformZapiLineDTO>(
        `${BASE}/status`,
        undefined,
        'Erro ao consultar a linha de verificação',
      ),
    initialData: initial,
    // The server rendered the saved state: no read on mount, only the slow
    // poll (catches a phone unpaired from the handset) and "Atualizar".
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: (query) =>
      query.state.data?.configured ? LINE_STATUS_POLL_MS : false,
  })
}

/**
 * QR code of the line, polled until the phone is paired. Stops after a
 * failure: retrying on an error only trips the rate limiter.
 */
export function usePlatformZapiLineQrCode(enabled: boolean) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: [...platformZapiLineKey, 'qr-code'],
    queryFn: async () => {
      const qr = await apiFetch<PlatformZapiLineQrCodeDTO>(
        `${BASE}/qr-code`,
        undefined,
        'Erro ao buscar o QR Code',
      )
      queryClient.setQueryData(platformZapiLineKey, qr.line)
      return qr
    },
    enabled,
    retry: false,
    gcTime: 0,
    refetchInterval: (query) =>
      query.state.data?.status === 'connected' || query.state.status === 'error'
        ? false
        : PLATFORM_LINE_QR_POLL_MS,
  })
}

function useLineMutation<Variables>(
  request: (variables: Variables) => Promise<PlatformZapiLineDTO>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: request,
    onSuccess: (line) => {
      queryClient.setQueryData(platformZapiLineKey, line)
      queryClient.removeQueries({
        queryKey: [...platformZapiLineKey, 'qr-code'],
      })
    },
  })
}

export interface SavePlatformZapiLineVariables {
  instanceId: string
  token: string
  clientToken?: string
  label?: string
  reason?: string
}

export function useSavePlatformZapiLine() {
  return useLineMutation((variables: SavePlatformZapiLineVariables) =>
    apiFetch<PlatformZapiLineDTO>(
      BASE,
      {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify(variables),
      },
      'Erro ao salvar as credenciais da linha',
    ),
  )
}

export function useDisconnectPlatformZapiLine() {
  return useLineMutation((variables: { reason: string }) =>
    apiFetch<PlatformZapiLineDTO>(
      `${BASE}/disconnect`,
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(variables),
      },
      'Erro ao desconectar a linha',
    ),
  )
}

export function useRestartPlatformZapiLine() {
  return useLineMutation((variables: { reason: string }) =>
    apiFetch<PlatformZapiLineDTO>(
      `${BASE}/restart`,
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(variables),
      },
      'Erro ao reiniciar a linha',
    ),
  )
}

export function useRemovePlatformZapiLine() {
  return useLineMutation((variables: { reason: string }) =>
    apiFetch<PlatformZapiLineDTO>(
      BASE,
      {
        method: 'DELETE',
        headers: JSON_HEADERS,
        body: JSON.stringify(variables),
      },
      'Erro ao remover a linha',
    ),
  )
}
