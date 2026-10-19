'use client'

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  ApolloSearchDTO,
  CreateApolloImportDTO,
  UpdateApolloSettingsDTO,
} from '@/src/schemas/crm-apollo.schema'
import type {
  CrmApolloConnectionDTO,
  CrmApolloContactsResultDTO,
  CrmApolloImportDTO,
  CrmApolloImportStatusDTO,
  CrmApolloLabelDTO,
  CrmApolloSearchResultDTO,
} from '@/types/crm-apollo'
import type { CrmMailingListDTO } from '@/types/crm-email-marketing'
import { apiFetch, apiFetchJson } from './_fetch'

/**
 * Apollo.io lead import (Leads > Importar da Apollo). Previews are 0 credits;
 * only the import mutation (queued in the worker) spends them. The API key is
 * managed in Ajustes > Integrações (`use-workspace-integrations`).
 */

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/crm/apollo`

export const crmApolloKeys = {
  connection: (ws: string) => ['crm-apollo', ws, 'connection'] as const,
  lists: (ws: string) => ['crm-apollo', ws, 'lists'] as const,
  imports: (ws: string) => ['crm-apollo', ws, 'imports'] as const,
}

/** Statuses whose numbers still move (the history polls while any is live). */
export const LIVE_APOLLO_IMPORT_STATUSES: CrmApolloImportStatusDTO[] = [
  'QUEUED',
  'RUNNING',
  'PAUSED_RATE_LIMIT',
]

export function useCrmApolloConnection(workspaceId: string) {
  return useQuery({
    queryKey: crmApolloKeys.connection(workspaceId),
    queryFn: () =>
      apiFetch<CrmApolloConnectionDTO>(
        `${base(workspaceId)}/integration`,
        undefined,
        'Erro ao buscar a conexão com a Apollo',
      ),
  })
}

/** Search preview. Runs on demand (the user presses "Buscar"). */
export function useCrmApolloSearch(workspaceId: string) {
  return useMutation({
    mutationFn: (data: ApolloSearchDTO) =>
      apiFetchJson<CrmApolloSearchResultDTO>(
        `${base(workspaceId)}/search`,
        'POST',
        data,
        'Erro ao buscar na Apollo',
      ),
  })
}

export function useCrmApolloLists(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: crmApolloKeys.lists(workspaceId),
    queryFn: () =>
      apiFetch<CrmApolloLabelDTO[]>(
        `${base(workspaceId)}/lists`,
        undefined,
        'Erro ao buscar as listas da Apollo',
      ),
    enabled,
    retry: false,
    staleTime: 60_000,
  })
}

export function useCrmApolloListContacts(
  workspaceId: string,
  labelId: string | null,
  page: number,
  perPage: number,
) {
  return useQuery({
    queryKey: ['crm-apollo', workspaceId, 'contacts', labelId, page, perPage],
    queryFn: () =>
      apiFetchJson<CrmApolloContactsResultDTO>(
        `${base(workspaceId)}/lists/${encodeURIComponent(labelId ?? '')}/contacts`,
        'POST',
        { page, perPage },
        'Erro ao buscar os contatos da lista',
      ),
    enabled: !!labelId,
    retry: false,
    placeholderData: keepPreviousData,
  })
}

export function useCrmApolloImports(workspaceId: string) {
  return useQuery({
    queryKey: crmApolloKeys.imports(workspaceId),
    queryFn: () =>
      apiFetch<CrmApolloImportDTO[]>(
        `${base(workspaceId)}/imports?limit=20`,
        undefined,
        'Erro ao buscar as importações',
      ),
    refetchInterval: (query) =>
      query.state.data?.some((item) =>
        LIVE_APOLLO_IMPORT_STATUSES.includes(item.status),
      )
        ? 4000
        : false,
  })
}

export function useCreateCrmApolloImport(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateApolloImportDTO) =>
      apiFetchJson<CrmApolloImportDTO>(
        `${base(workspaceId)}/imports`,
        'POST',
        data,
        'Erro ao iniciar a importação',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmApolloKeys.imports(workspaceId),
      }),
  })
}

/** Destination lists offered in the import footer. */
export function useCrmApolloMailingLists(workspaceId: string) {
  return useQuery({
    queryKey: ['crm-mailing-lists', workspaceId],
    queryFn: () =>
      apiFetch<CrmMailingListDTO[]>(
        `/api/workspaces/${workspaceId}/crm/mailing-lists`,
        undefined,
        'Erro ao buscar as listas de e-mail',
      ),
    staleTime: 30_000,
  })
}

/** Default destination list of the imports (admin only). */
export function useUpdateCrmApolloSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateApolloSettingsDTO) =>
      apiFetchJson<CrmApolloConnectionDTO>(
        `${base(workspaceId)}/integration`,
        'PATCH',
        data,
        'Erro ao salvar a lista padrão',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmApolloKeys.connection(workspaceId),
      }),
  })
}
