'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CustomerLinkKind,
  CustomerLinkStateDTO,
  ResolvedCustomerDTO,
} from '@/types/customer-link'
import { apiFetch } from './_fetch'

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/crm/customer-links`

const stateKey = (workspaceId: string, kind: CustomerLinkKind, id: string) =>
  ['customer-link', workspaceId, kind, id] as const

/** Current CRM link of a ServiceDesk / WhatsApp record, with suggestions. */
export function useCustomerLink(
  workspaceId: string,
  kind: CustomerLinkKind,
  id: string | null,
) {
  return useQuery({
    queryKey: stateKey(workspaceId, kind, id ?? ''),
    enabled: Boolean(id),
    queryFn: () =>
      apiFetch<CustomerLinkStateDTO>(
        `${base(workspaceId)}/suggestions?kind=${kind}&id=${encodeURIComponent(id ?? '')}`,
        undefined,
        'Não foi possível carregar o vínculo com o CRM',
      ),
  })
}

/** Links (`targetId`) or unlinks (`null`) a record. */
export function useChangeCustomerLink(
  workspaceId: string,
  kind: CustomerLinkKind,
  id: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (targetId: string | null) =>
      targetId
        ? apiFetch<{ linked: true }>(
            base(workspaceId),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kind, id, targetId }),
            },
            'Não foi possível vincular ao CRM',
          )
        : apiFetch<{ linked: false }>(
            `${base(workspaceId)}?kind=${kind}&id=${encodeURIComponent(id)}`,
            { method: 'DELETE' },
            'Não foi possível desfazer o vínculo',
          ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: stateKey(workspaceId, kind, id),
      })
      queryClient.invalidateQueries({
        queryKey: ['customer-resolve', workspaceId],
      })
    },
  })
}

export interface ResolveCustomerQuery {
  companyId?: string
  personId?: string
  sdCustomerId?: string
  cnpj?: string
  phone?: string
}

/** One customer seen from CRM, ServiceDesk and WhatsApp. */
export function useResolvedCustomer(
  workspaceId: string,
  query: ResolveCustomerQuery,
) {
  const qs = new URLSearchParams(
    Object.entries(query).filter(([, v]) => Boolean(v)) as [string, string][],
  ).toString()
  return useQuery({
    queryKey: ['customer-resolve', workspaceId, qs],
    enabled: qs.length > 0,
    queryFn: () =>
      apiFetch<ResolvedCustomerDTO>(
        `${base(workspaceId)}/resolve?${qs}`,
        undefined,
        'Não foi possível carregar o cadastro unificado',
      ),
  })
}
