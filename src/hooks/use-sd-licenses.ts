'use client'

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  SdConfigItemLicenseDTO,
  SdLicenseDetailDTO,
  SdLicenseDTO,
  SdLicenseListDTO,
  SdLicenseStatusDTO,
} from '@/types/sd-license'
import { apiFetch, apiFetchJson } from './_fetch'
import { sdBase, sdQueryString } from './_sd-directory'

/**
 * Licenças de software do ServiceDesk (S7). Tudo sob a chave
 * `['sd-licenses', workspaceId]`, então qualquer mutação atualiza a tela.
 */

export interface SdLicensesQuery {
  search?: string
  status?: SdLicenseStatusDTO
  includeArchived?: boolean
}

export const sdLicenseKeys = {
  all: (workspaceId: string) => ['sd-licenses', workspaceId] as const,
}

/** Corpo de criação/edição como o formulário o monta (datas `YYYY-MM-DD`). */
export interface SdLicenseFormInput {
  name: string
  vendor?: string | null
  matchPattern: string
  seats: number
  unitCostCents?: number | null
  purchasedAt?: string | null
  expiresAt?: string | null
  renewalNoticeDays?: number
  notes?: string | null
}

function useInvalidate(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({
      queryKey: sdLicenseKeys.all(workspaceId),
    })
}

export function useSdLicenses(workspaceId: string, query: SdLicensesQuery) {
  return useQuery({
    queryKey: [...sdLicenseKeys.all(workspaceId), 'list', query],
    queryFn: () =>
      apiFetch<SdLicenseListDTO>(
        `${sdBase(workspaceId, 'licenses')}${sdQueryString({
          search: query.search,
          status: query.status,
          includeArchived: query.includeArchived ? 'true' : undefined,
        })}`,
        undefined,
        'Erro ao carregar as licenças',
      ),
    enabled: !!workspaceId,
    placeholderData: keepPreviousData,
  })
}

export function useSdLicense(workspaceId: string, licenseId: string | null) {
  return useQuery({
    queryKey: [...sdLicenseKeys.all(workspaceId), 'detail', licenseId],
    queryFn: () =>
      apiFetch<SdLicenseDetailDTO>(
        sdBase(workspaceId, `licenses/${licenseId}`),
        undefined,
        'Erro ao carregar a licença',
      ),
    enabled: !!workspaceId && !!licenseId,
  })
}

export function useSdConfigItemLicenses(
  workspaceId: string,
  configItemId: string,
) {
  return useQuery({
    queryKey: [...sdLicenseKeys.all(workspaceId), 'config-item', configItemId],
    queryFn: () =>
      apiFetch<SdConfigItemLicenseDTO[]>(
        sdBase(workspaceId, `config-items/${configItemId}/licenses`),
        undefined,
        'Erro ao carregar as licenças do ativo',
      ),
    enabled: !!workspaceId && !!configItemId,
  })
}

export function useCreateSdLicense(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (data: SdLicenseFormInput) =>
      apiFetchJson<SdLicenseDTO>(
        sdBase(workspaceId, 'licenses'),
        'POST',
        data,
        'Erro ao cadastrar a licença',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateSdLicense(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Partial<SdLicenseFormInput>
    }) =>
      apiFetchJson<SdLicenseDTO>(
        sdBase(workspaceId, `licenses/${id}`),
        'PATCH',
        data,
        'Erro ao salvar a licença',
      ),
    onSuccess: invalidate,
  })
}

export function useArchiveSdLicense(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      archived
        ? apiFetchJson<SdLicenseDTO>(
            sdBase(workspaceId, `licenses/${id}`),
            'DELETE',
            undefined,
            'Erro ao arquivar a licença',
          )
        : apiFetchJson<SdLicenseDTO>(
            sdBase(workspaceId, `licenses/${id}/restore`),
            'POST',
            {},
            'Erro ao restaurar a licença',
          ),
    onSuccess: invalidate,
  })
}

export function useSetSdLicenseAssets(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: ({
      id,
      configItemIds,
    }: {
      id: string
      configItemIds: string[]
    }) =>
      apiFetchJson<SdLicenseDTO>(
        sdBase(workspaceId, `licenses/${id}/assets`),
        'PUT',
        { configItemIds },
        'Erro ao atribuir os ativos',
      ),
    onSuccess: invalidate,
  })
}
