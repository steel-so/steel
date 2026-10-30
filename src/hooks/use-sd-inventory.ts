'use client'

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  CreateSdInventoryDiscoveryRangeDTO,
  CreateSdInventorySnmpTargetDTO,
  CreateSdInventoryTokenDTO,
  MergeSdInventoryDeviceDTO,
  UpdateSdInventoryDiscoveryRangeDTO,
  UpdateSdInventorySettingsDTO,
  UpdateSdInventorySnmpTargetDTO,
} from '@/src/schemas/sd-inventory.schema'
import type { SdPage } from '@/types/sd-directory'
import type {
  SdInventoryAdoptResultDTO,
  SdInventoryAgentReleaseDTO,
  SdInventoryAlertDTO,
  SdInventoryAlertStatusDTO,
  SdInventoryDeviceDetailDTO,
  SdInventoryDeviceDTO,
  SdInventoryDiscoveryRangeDTO,
  SdInventorySettingsDTO,
  SdInventorySnmpTargetDTO,
  SdInventorySoftwareCatalogRowDTO,
  SdInventorySourceDTO,
  SdInventorySummaryDTO,
  SdInventoryTokenDTO,
  SdInventoryTokenWithValueDTO,
} from '@/types/sd-inventory'
import { apiFetch, apiSend } from './_fetch'
import { sdBase, sdJson, sdQueryString } from './_sd-directory'

/**
 * Inventário e descoberta de ativos do ServiceDesk (S1). Tudo sob a chave
 * `['sd-inventory', workspaceId]`, então qualquer mutação atualiza a tela.
 *
 * O valor do token do agente **só** volta na criação — guarde o resultado da
 * mutação para mostrá-lo uma vez.
 */

export interface SdInventoryDevicesQuery {
  search?: string
  source?: SdInventorySourceDTO
  hasAlert?: boolean
  stale?: boolean
  /** Só os descobertos por ping/ARP, ainda sem gestão. */
  discovered?: boolean
  page?: number
  pageSize?: number
}

export interface SdInventoryAlertsQuery {
  status?: SdInventoryAlertStatusDTO
  kind?: 'DISK' | 'RAM'
  deviceId?: string
  limit?: number
}

export interface SdInventorySoftwareQuery {
  search?: string
  page?: number
  pageSize?: number
}

export const sdInventoryKeys = {
  all: (workspaceId: string) => ['sd-inventory', workspaceId] as const,
}

const path = (suffix: string) => `inventory/${suffix}`

function useInvalidate(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({
      queryKey: sdInventoryKeys.all(workspaceId),
    })
}

export function useSdInventorySummary(workspaceId: string) {
  return useQuery({
    queryKey: [...sdInventoryKeys.all(workspaceId), 'summary'],
    queryFn: () =>
      apiFetch<SdInventorySummaryDTO>(
        sdBase(workspaceId, path('summary')),
        undefined,
        'Erro ao carregar o resumo do inventário',
      ),
    enabled: !!workspaceId,
  })
}

export function useSdInventoryDevices(
  workspaceId: string,
  query: SdInventoryDevicesQuery,
) {
  return useQuery({
    queryKey: [...sdInventoryKeys.all(workspaceId), 'devices', query],
    queryFn: () =>
      apiFetch<SdPage<SdInventoryDeviceDTO>>(
        `${sdBase(workspaceId, path('devices'))}${sdQueryString({
          ...query,
          hasAlert: query.hasAlert ? 'true' : undefined,
          stale: query.stale ? 'true' : undefined,
          discovered: query.discovered ? 'true' : undefined,
        })}`,
        undefined,
        'Erro ao carregar os equipamentos',
      ),
    enabled: !!workspaceId,
    placeholderData: keepPreviousData,
  })
}

export function useSdInventoryDevice(
  workspaceId: string,
  deviceId: string | null,
) {
  return useQuery({
    queryKey: [...sdInventoryKeys.all(workspaceId), 'device', deviceId],
    queryFn: () =>
      apiFetch<SdInventoryDeviceDetailDTO>(
        sdBase(workspaceId, path(`devices/${deviceId}`)),
        undefined,
        'Erro ao carregar o equipamento',
      ),
    enabled: !!workspaceId && !!deviceId,
  })
}

export function useSdInventoryAlerts(
  workspaceId: string,
  query: SdInventoryAlertsQuery = {},
) {
  return useQuery({
    queryKey: [...sdInventoryKeys.all(workspaceId), 'alerts', query],
    queryFn: () =>
      apiFetch<SdInventoryAlertDTO[]>(
        `${sdBase(workspaceId, path('alerts'))}${sdQueryString({ ...query })}`,
        undefined,
        'Erro ao carregar os alertas do inventário',
      ),
    enabled: !!workspaceId,
  })
}

export function useSdInventorySoftware(
  workspaceId: string,
  query: SdInventorySoftwareQuery,
) {
  return useQuery({
    queryKey: [...sdInventoryKeys.all(workspaceId), 'software', query],
    queryFn: () =>
      apiFetch<SdPage<SdInventorySoftwareCatalogRowDTO>>(
        `${sdBase(workspaceId, path('software'))}${sdQueryString({ ...query })}`,
        undefined,
        'Erro ao carregar o catálogo de software',
      ),
    enabled: !!workspaceId,
    placeholderData: keepPreviousData,
  })
}

export function useSdInventorySettings(workspaceId: string) {
  return useQuery({
    queryKey: [...sdInventoryKeys.all(workspaceId), 'settings'],
    queryFn: () =>
      apiFetch<SdInventorySettingsDTO>(
        sdBase(workspaceId, path('settings')),
        undefined,
        'Erro ao carregar os ajustes do inventário',
      ),
    enabled: !!workspaceId,
  })
}

export function useSdInventorySettingsMutation(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (data: UpdateSdInventorySettingsDTO) =>
      apiFetch<SdInventorySettingsDTO>(
        sdBase(workspaceId, path('settings')),
        sdJson('PATCH', data),
        'Erro ao salvar os ajustes do inventário',
      ),
    onSuccess: invalidate,
  })
}

export function useSdInventoryTokens(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: [...sdInventoryKeys.all(workspaceId), 'tokens'],
    queryFn: () =>
      apiFetch<SdInventoryTokenDTO[]>(
        sdBase(workspaceId, path('tokens')),
        undefined,
        'Erro ao carregar os tokens do agente',
      ),
    enabled: !!workspaceId && enabled,
  })
}

export function useSdInventoryTokenMutations(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  const url = sdBase(workspaceId, path('tokens'))
  const create = useMutation({
    mutationFn: (data: CreateSdInventoryTokenDTO) =>
      apiFetch<SdInventoryTokenWithValueDTO>(
        url,
        sdJson('POST', data),
        'Erro ao criar o token',
      ),
    onSuccess: invalidate,
  })
  const revoke = useMutation({
    mutationFn: (id: string) =>
      apiSend(`${url}/${id}`, { method: 'DELETE' }, 'Erro ao revogar o token'),
    onSuccess: invalidate,
  })
  return { create, revoke }
}

export function useSdInventoryTargets(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: [...sdInventoryKeys.all(workspaceId), 'targets'],
    queryFn: () =>
      apiFetch<SdInventorySnmpTargetDTO[]>(
        sdBase(workspaceId, path('snmp-targets')),
        undefined,
        'Erro ao carregar os alvos SNMP',
      ),
    enabled: !!workspaceId && enabled,
  })
}

export function useSdInventoryTargetMutations(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  const url = sdBase(workspaceId, path('snmp-targets'))
  const create = useMutation({
    mutationFn: (data: CreateSdInventorySnmpTargetDTO) =>
      apiFetch<SdInventorySnmpTargetDTO>(
        url,
        sdJson('POST', data),
        'Erro ao criar o alvo',
      ),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: UpdateSdInventorySnmpTargetDTO
    }) =>
      apiFetch<SdInventorySnmpTargetDTO>(
        `${url}/${id}`,
        sdJson('PATCH', data),
        'Erro ao salvar o alvo',
      ),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiSend(`${url}/${id}`, { method: 'DELETE' }, 'Erro ao excluir o alvo'),
    onSuccess: invalidate,
  })
  const scanNow = useMutation({
    mutationFn: (id: string) =>
      apiSend(
        `${url}/${id}/scan`,
        { method: 'POST' },
        'Erro ao pedir a varredura',
      ),
    onSuccess: invalidate,
  })
  return { create, update, remove, scanNow }
}

export function useSdInventoryDiscoveryRanges(
  workspaceId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: [...sdInventoryKeys.all(workspaceId), 'discovery-ranges'],
    queryFn: () =>
      apiFetch<SdInventoryDiscoveryRangeDTO[]>(
        sdBase(workspaceId, path('discovery-ranges')),
        undefined,
        'Erro ao carregar as faixas de descoberta',
      ),
    enabled: !!workspaceId && enabled,
  })
}

export function useSdInventoryDiscoveryMutations(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  const url = sdBase(workspaceId, path('discovery-ranges'))
  const create = useMutation({
    mutationFn: (data: CreateSdInventoryDiscoveryRangeDTO) =>
      apiFetch<SdInventoryDiscoveryRangeDTO>(
        url,
        sdJson('POST', data),
        'Erro ao criar a faixa',
      ),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: UpdateSdInventoryDiscoveryRangeDTO
    }) =>
      apiFetch<SdInventoryDiscoveryRangeDTO>(
        `${url}/${id}`,
        sdJson('PATCH', data),
        'Erro ao salvar a faixa',
      ),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiSend(`${url}/${id}`, { method: 'DELETE' }, 'Erro ao excluir a faixa'),
    onSuccess: invalidate,
  })
  const scanNow = useMutation({
    mutationFn: (id: string) =>
      apiSend(
        `${url}/${id}/scan`,
        { method: 'POST' },
        'Erro ao pedir a descoberta',
      ),
    onSuccess: invalidate,
  })
  return { create, update, remove, scanNow }
}

/** Mesclar, desfazer a mescla, adotar e descartar um equipamento. */
export function useSdInventoryDeviceActions(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  const url = (deviceId: string) =>
    sdBase(workspaceId, path(`devices/${deviceId}`))
  const merge = useMutation({
    mutationFn: ({
      deviceId,
      data,
    }: {
      deviceId: string
      data: MergeSdInventoryDeviceDTO
    }) =>
      apiSend(
        `${url(deviceId)}/merge`,
        sdJson('POST', data),
        'Erro ao mesclar os equipamentos',
      ),
    onSuccess: invalidate,
  })
  const unmerge = useMutation({
    mutationFn: (deviceId: string) =>
      apiSend(
        `${url(deviceId)}/unmerge`,
        { method: 'POST' },
        'Erro ao desfazer a mescla',
      ),
    onSuccess: invalidate,
  })
  const adopt = useMutation({
    mutationFn: (deviceId: string) =>
      apiFetch<SdInventoryAdoptResultDTO>(
        `${url(deviceId)}/adopt`,
        { method: 'POST' },
        'Erro ao adotar o equipamento',
      ),
    onSuccess: invalidate,
  })
  const dismiss = useMutation({
    mutationFn: (deviceId: string) =>
      apiSend(
        url(deviceId),
        { method: 'DELETE' },
        'Erro ao descartar o equipamento',
      ),
    onSuccess: invalidate,
  })
  return { merge, unmerge, adopt, dismiss }
}

export function useSdInventoryAgentReleases(
  workspaceId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: [...sdInventoryKeys.all(workspaceId), 'agent-releases'],
    queryFn: () =>
      apiFetch<SdInventoryAgentReleaseDTO[]>(
        sdBase(workspaceId, path('agent-releases')),
        undefined,
        'Erro ao carregar as versões do agente',
      ),
    enabled: !!workspaceId && enabled,
  })
}
