'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateSdWfmSettingsDTO } from '@/src/schemas/sd-wfm.schema'
import type { SdWfmForecastDTO, SdWfmSettingsDTO } from '@/types/sd-wfm'
import { apiFetch, apiFetchJson } from './_fetch'
import { sdBase, sdQueryString } from './_sd-directory'

/**
 * Previsão de demanda e dimensionamento (S5). Tudo sob
 * `['sd-wfm', workspaceId]`: salvar os ajustes recalcula a previsão.
 */

export const sdWfmKeys = {
  all: (workspaceId: string) => ['sd-wfm', workspaceId] as const,
  forecast: (workspaceId: string, departmentId?: string) =>
    ['sd-wfm', workspaceId, 'forecast', departmentId ?? null] as const,
}

export function useSdWfmForecast(workspaceId: string, departmentId?: string) {
  return useQuery({
    queryKey: sdWfmKeys.forecast(workspaceId, departmentId),
    queryFn: () =>
      apiFetch<SdWfmForecastDTO>(
        `${sdBase(workspaceId, 'wfm/forecast')}${sdQueryString({ departmentId })}`,
        undefined,
        'Erro ao carregar a previsão de demanda',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateSdWfmSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dto: UpdateSdWfmSettingsDTO) =>
      apiFetchJson<SdWfmSettingsDTO>(
        sdBase(workspaceId, 'wfm/settings'),
        'PATCH',
        dto,
        'Erro ao salvar os ajustes da previsão',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: sdWfmKeys.all(workspaceId) }),
  })
}
