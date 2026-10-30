'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  EnrichCompanyDTO,
  StartCnpjRunDTO,
} from '@/src/schemas/crm-cnpj.schema'
import type {
  CrmCnpjProfileDTO,
  CrmCnpjRunDTO,
  CrmCnpjRunStatusDTO,
  CrmCompanyEnrichmentDTO,
  CrmCompanyEnrichResultDTO,
} from '@/types/crm-cnpj'
import { apiFetch, apiFetchJson } from './_fetch'

/**
 * CNPJ enrichment of CRM companies: Receita profile of one company, preview
 * of a typed CNPJ and the bulk "reenriquecer a base" runs (worker).
 */

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/crm/companies`

export const crmCnpjKeys = {
  enrichment: (ws: string, companyId: string) =>
    ['crm-cnpj', ws, 'enrichment', companyId] as const,
  runs: (ws: string) => ['crm-cnpj', ws, 'runs'] as const,
}

/** Statuses whose numbers still move (the list polls while any is live). */
export const LIVE_CNPJ_RUN_STATUSES: CrmCnpjRunStatusDTO[] = [
  'QUEUED',
  'RUNNING',
]

/** Stored Receita profile of a company (`null` until it is enriched). */
export function useCrmCompanyEnrichment(
  workspaceId: string,
  companyId: string,
) {
  return useQuery({
    queryKey: crmCnpjKeys.enrichment(workspaceId, companyId),
    queryFn: () =>
      apiFetch<CrmCompanyEnrichmentDTO | null>(
        `${base(workspaceId)}/${companyId}/enrichment`,
        undefined,
        'Erro ao buscar os dados da Receita',
      ),
  })
}

export function useEnrichCrmCompany(
  workspaceId: string,
  companyId: string,
  onApplied?: () => void,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: EnrichCompanyDTO) =>
      apiFetchJson<CrmCompanyEnrichResultDTO>(
        `${base(workspaceId)}/${companyId}/enrichment`,
        'POST',
        data,
        'Erro ao consultar a Receita',
      ),
    onSuccess: (result) => {
      queryClient.setQueryData(
        crmCnpjKeys.enrichment(workspaceId, companyId),
        result.enrichment,
      )
      if (result.applied.length > 0) onApplied?.()
    },
  })
}

/** Registry preview for a typed CNPJ (nothing is saved). */
export function useLookupCnpj(workspaceId: string) {
  return useMutation({
    mutationFn: (cnpj: string) =>
      apiFetchJson<CrmCnpjProfileDTO>(
        `${base(workspaceId)}/cnpj-lookup`,
        'POST',
        { cnpj },
        'Erro ao consultar o CNPJ',
      ),
  })
}

export function useCrmCnpjRuns(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: crmCnpjKeys.runs(workspaceId),
    queryFn: () =>
      apiFetch<CrmCnpjRunDTO[]>(
        `${base(workspaceId)}/enrichment-runs?limit=10`,
        undefined,
        'Erro ao buscar os reenriquecimentos',
      ),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.some((run) =>
        LIVE_CNPJ_RUN_STATUSES.includes(run.status),
      )
        ? 3000
        : false,
  })
}

/** Asks the worker to stop a run (cooperative: it stops between companies). */
export function useCancelCnpjRun(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) =>
      apiFetchJson<CrmCnpjRunDTO>(
        `${base(workspaceId)}/enrichment-runs/${runId}/cancel`,
        'POST',
        {},
        'Erro ao cancelar o reenriquecimento',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmCnpjKeys.runs(workspaceId),
      }),
  })
}

export function useStartCnpjRun(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: StartCnpjRunDTO) =>
      apiFetchJson<CrmCnpjRunDTO>(
        `${base(workspaceId)}/enrichment-runs`,
        'POST',
        data,
        'Erro ao iniciar o reenriquecimento',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: crmCnpjKeys.runs(workspaceId),
      }),
  })
}
