'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateSdMaintenanceInput,
  CreateSdStatusComponentInput,
  UpdateSdMaintenanceInput,
  UpdateSdStatusComponentInput,
} from '@/src/schemas/sd-status-maintenance.schema'
import type {
  SdStatusComponentDTO,
  SdStatusComponentListDTO,
  SdStatusMaintenanceDTO,
  SdStatusMaintenanceListDTO,
} from '@/types/sd-status-maintenance'
import { apiFetch, apiSend } from './_fetch'
import { sdBase, sdJson } from './_sd-directory'
import { sdStatusPageKeys } from './use-sd-status-pages'

/**
 * Componentes por serviço das páginas de status e janelas de manutenção
 * programada (sd-followups). Chave `['sd-status-maintenance', workspaceId]`;
 * a página pública (`usePublicSdStatusPage`) já traz os dois no DTO.
 */

export const sdStatusMaintenanceKeys = {
  all: (workspaceId: string) => ['sd-status-maintenance', workspaceId] as const,
}

function useInvalidate(workspaceId: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: sdStatusMaintenanceKeys.all(workspaceId),
    })
    queryClient.invalidateQueries({
      queryKey: sdStatusPageKeys.all(workspaceId),
    })
  }
}

export function useSdStatusComponents(
  workspaceId: string,
  pageId: string | null,
) {
  return useQuery({
    queryKey: [
      ...sdStatusMaintenanceKeys.all(workspaceId),
      'components',
      pageId,
    ],
    queryFn: () =>
      apiFetch<SdStatusComponentListDTO>(
        sdBase(workspaceId, `status-pages/${pageId}/components`),
        undefined,
        'Erro ao carregar os componentes',
      ),
    enabled: !!workspaceId && !!pageId,
  })
}

export function useCreateSdStatusComponent(
  workspaceId: string,
  pageId: string,
) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (
      input: Partial<CreateSdStatusComponentInput> & { name: string },
    ) =>
      apiFetch<SdStatusComponentDTO>(
        sdBase(workspaceId, `status-pages/${pageId}/components`),
        sdJson('POST', input),
        'Erro ao criar o componente',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateSdStatusComponent(
  workspaceId: string,
  pageId: string,
) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: UpdateSdStatusComponentInput
    }) =>
      apiFetch<SdStatusComponentDTO>(
        sdBase(workspaceId, `status-pages/${pageId}/components/${id}`),
        sdJson('PATCH', data),
        'Erro ao salvar o componente',
      ),
    onSuccess: invalidate,
  })
}

export function useRemoveSdStatusComponent(
  workspaceId: string,
  pageId: string,
) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (id: string) =>
      apiSend(
        sdBase(workspaceId, `status-pages/${pageId}/components/${id}`),
        { method: 'DELETE' },
        'Erro ao remover o componente',
      ),
    onSuccess: invalidate,
  })
}

export function useSdMaintenances(workspaceId: string) {
  return useQuery({
    queryKey: [...sdStatusMaintenanceKeys.all(workspaceId), 'windows'],
    queryFn: () =>
      apiFetch<SdStatusMaintenanceListDTO>(
        sdBase(workspaceId, 'status-maintenances'),
        undefined,
        'Erro ao carregar as manutenções',
      ),
    enabled: !!workspaceId,
  })
}

/** Dates travel as ISO strings (the server turns them into dates). */
type MaintenanceBody<T> = {
  [K in keyof T]: T[K] extends Date | undefined ? string | undefined : T[K]
}

export function useCreateSdMaintenance(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (
      input: Omit<
        MaintenanceBody<CreateSdMaintenanceInput>,
        | 'suppressMonitoring'
        | 'configItemIds'
        | 'notifySubscribers'
        | 'description'
      > &
        Partial<
          Pick<
            CreateSdMaintenanceInput,
            | 'suppressMonitoring'
            | 'configItemIds'
            | 'notifySubscribers'
            | 'description'
          >
        >,
    ) =>
      apiFetch<SdStatusMaintenanceDTO>(
        sdBase(workspaceId, 'status-maintenances'),
        sdJson('POST', input),
        'Erro ao agendar a manutenção',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateSdMaintenance(workspaceId: string, id: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (input: MaintenanceBody<UpdateSdMaintenanceInput>) =>
      apiFetch<SdStatusMaintenanceDTO>(
        sdBase(workspaceId, `status-maintenances/${id}`),
        sdJson('PATCH', input),
        'Erro ao salvar a manutenção',
      ),
    onSuccess: invalidate,
  })
}

export function useCancelSdMaintenance(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (id: string) =>
      apiSend(
        sdBase(workspaceId, `status-maintenances/${id}`),
        { method: 'DELETE' },
        'Erro ao cancelar a manutenção',
      ),
    onSuccess: invalidate,
  })
}
