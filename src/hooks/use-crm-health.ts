'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CrmCustomerHealthDTO,
  CrmHealthLevelDTO,
  CrmOpportunityHealthDTO,
} from '@/types/crm-health'
import { apiFetch, apiFetchJson } from './_fetch'

/**
 * CRM health scores (nov-health-scores): customer churn risk (T4) and
 * open-deal risk (C4). The scores are computed by the worker; the screens
 * only read them and ask for a recompute on demand.
 */

const base = (ws: string) =>
  `/api/workspaces/${encodeURIComponent(ws)}/crm/health`

export const crmHealthKeys = {
  all: (ws: string) => ['crm-health', ws] as const,
  customer: (ws: string, companyId: string) =>
    ['crm-health', ws, 'customer', companyId] as const,
  customers: (ws: string, level?: CrmHealthLevelDTO) =>
    ['crm-health', ws, 'customers', level ?? 'all'] as const,
  opportunity: (ws: string, opportunityId: string) =>
    ['crm-health', ws, 'opportunity', opportunityId] as const,
  opportunities: (ws: string) => ['crm-health', ws, 'opportunities'] as const,
}

/** Customers ranked by churn risk (riskiest first). */
export function useCrmCustomerHealthRanking(
  workspaceId: string,
  options: { level?: CrmHealthLevelDTO; limit?: number } = {},
) {
  const params = new URLSearchParams()
  if (options.level) params.set('level', options.level)
  params.set('limit', String(options.limit ?? 50))
  return useQuery({
    queryKey: crmHealthKeys.customers(workspaceId, options.level),
    queryFn: () =>
      apiFetch<CrmCustomerHealthDTO[]>(
        `${base(workspaceId)}/companies?${params.toString()}`,
        undefined,
        'Erro ao buscar a saúde dos clientes',
      ),
    enabled: Boolean(workspaceId),
  })
}

export function useCrmCustomerHealth(workspaceId: string, companyId: string) {
  return useQuery({
    queryKey: crmHealthKeys.customer(workspaceId, companyId),
    queryFn: () =>
      apiFetch<CrmCustomerHealthDTO>(
        `${base(workspaceId)}/companies/${companyId}`,
        undefined,
        'Erro ao buscar a saúde do cliente',
      ),
    enabled: Boolean(workspaceId) && Boolean(companyId),
  })
}

export function useRecomputeCrmCustomerHealth(
  workspaceId: string,
  companyId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetchJson<CrmCustomerHealthDTO>(
        `${base(workspaceId)}/companies/${companyId}`,
        'POST',
        {},
        'Erro ao recalcular a saúde do cliente',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(
        crmHealthKeys.customer(workspaceId, companyId),
        data,
      )
      queryClient.invalidateQueries({
        queryKey: crmHealthKeys.customers(workspaceId),
      })
    },
  })
}

/** Health of every open deal, keyed by opportunity id (kanban badges). */
export function useCrmOpportunityHealthMap(workspaceId: string) {
  return useQuery({
    queryKey: crmHealthKeys.opportunities(workspaceId),
    queryFn: async () => {
      const rows = await apiFetch<CrmOpportunityHealthDTO[]>(
        `${base(workspaceId)}/opportunities?limit=1000`,
        undefined,
        'Erro ao buscar a saúde das oportunidades',
      )
      return new Map(rows.map((row) => [row.opportunityId, row]))
    },
    enabled: Boolean(workspaceId),
    // The worker rescored it at most an hour ago; no need to hammer.
    staleTime: 60_000,
  })
}

export function useCrmOpportunityHealth(
  workspaceId: string,
  opportunityId: string,
) {
  return useQuery({
    queryKey: crmHealthKeys.opportunity(workspaceId, opportunityId),
    queryFn: () =>
      apiFetch<CrmOpportunityHealthDTO>(
        `${base(workspaceId)}/opportunities/${opportunityId}`,
        undefined,
        'Erro ao buscar a saúde da oportunidade',
      ),
    enabled: Boolean(workspaceId) && Boolean(opportunityId),
    retry: false,
  })
}

export function useRecomputeCrmOpportunityHealth(
  workspaceId: string,
  opportunityId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetchJson<CrmOpportunityHealthDTO>(
        `${base(workspaceId)}/opportunities/${opportunityId}`,
        'POST',
        {},
        'Erro ao recalcular a saúde da oportunidade',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(
        crmHealthKeys.opportunity(workspaceId, opportunityId),
        data,
      )
      queryClient.invalidateQueries({
        queryKey: crmHealthKeys.opportunities(workspaceId),
      })
    },
  })
}

/** Creates a CRM task from the suggested next action. */
export function useCreateTaskFromHealthAction(workspaceId: string) {
  return useMutation({
    mutationFn: (input: {
      title: string
      body: string
      companyId?: string
      opportunityId?: string
    }) =>
      apiFetchJson<{ id: string }>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/crm/tasks`,
        'POST',
        {
          ...input,
          // Due tomorrow: the action is for the next working moment.
          dueDate: new Date(Date.now() + 86_400_000).toISOString(),
        },
        'Erro ao criar a tarefa',
      ),
  })
}
