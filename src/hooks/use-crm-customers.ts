'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type {
  CrmCustomerFilters,
  CrmCustomersPageDTO,
} from '@/src/schemas/crm-customer.schema'
import { apiFetch } from './_fetch'

/** Clientes (CRM > Fidelizar): companies and people with a won deal. */

export type CrmCustomerQuery = Partial<
  Omit<CrmCustomerFilters, 'kind' | 'sort' | 'dir'>
> &
  Pick<CrmCustomerFilters, 'kind' | 'sort' | 'dir'> & {
    page: number
    pageSize: number
  }

const base = (ws: string) => `/api/workspaces/${ws}/crm/customers`

/** Query string of the filters (empty ones are left out). */
export function crmCustomersSearch(
  query: Partial<CrmCustomerQuery>,
  withPaging: boolean,
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (!withPaging && (key === 'page' || key === 'pageSize')) continue
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  return params.toString()
}

export function crmCustomersExportUrl(
  workspaceId: string,
  query: CrmCustomerQuery,
): string {
  return `${base(workspaceId)}/export?${crmCustomersSearch(query, false)}`
}

export const crmCustomerKeys = {
  list: (ws: string, query: CrmCustomerQuery) =>
    ['crm-customers', ws, query] as const,
  options: (ws: string) => ['crm-customers', ws, 'options'] as const,
}

export function useCrmCustomers(workspaceId: string, query: CrmCustomerQuery) {
  return useQuery({
    queryKey: crmCustomerKeys.list(workspaceId, query),
    queryFn: () =>
      apiFetch<CrmCustomersPageDTO>(
        `${base(workspaceId)}?${crmCustomersSearch(query, true)}`,
        undefined,
        'Erro ao buscar os clientes',
      ),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  })
}

export function useCrmCustomerOptions(workspaceId: string) {
  return useQuery({
    queryKey: crmCustomerKeys.options(workspaceId),
    queryFn: () =>
      apiFetch<{
        pipelines: { id: string; name: string }[]
        products: { id: string; name: string }[]
      }>(`${base(workspaceId)}/options`, undefined, 'Erro ao buscar filtros'),
    staleTime: 5 * 60 * 1000,
  })
}
