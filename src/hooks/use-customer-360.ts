'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Customer360DTO,
  Customer360OpenWhatsappResultDTO,
} from '@/types/customer-360'
import { apiFetch } from './_fetch'

/**
 * "Visão 360": the customer across CRM, ServiceDesk and WhatsApp. One read
 * (`GET customer-360`) feeds the CRM tab, the card inside the ticket and the
 * side panel of the zap conversation; the mutations below are the quick
 * actions of that panel and the WhatsApp button of the CRM records.
 */

export interface Customer360Anchor {
  personId?: string
  companyId?: string
  phone?: string
  ticketId?: string
  conversationId?: string
}

const base = (workspaceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/customer-360`

export const customer360Keys = {
  all: (workspaceId: string) => ['customer-360', workspaceId] as const,
  anchor: (workspaceId: string, anchor: Customer360Anchor) =>
    ['customer-360', workspaceId, anchor] as const,
}

function hasAnchor(anchor: Customer360Anchor): boolean {
  return Object.values(anchor).some(Boolean)
}

export function useCustomer360(
  workspaceId: string,
  anchor: Customer360Anchor,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: customer360Keys.anchor(workspaceId, anchor),
    queryFn: () => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(anchor)) {
        if (value) params.set(key, value)
      }
      return apiFetch<Customer360DTO>(
        `${base(workspaceId)}?${params.toString()}`,
        undefined,
        'Não foi possível carregar a visão 360 do cliente',
      )
    },
    enabled: Boolean(workspaceId) && hasAnchor(anchor) && options.enabled !== false,
    staleTime: 30_000,
    // 403/404 mean "not for you" (module off, no permission): do not retry.
    retry: false,
  })
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/** Opens (or reuses) the WhatsApp conversation of a person, company or deal. */
export function useOpenCustomerWhatsapp(workspaceId: string) {
  return useMutation({
    mutationFn: (target: {
      personId?: string
      companyId?: string
      opportunityId?: string
      phone?: string
    }) =>
      apiFetch<Customer360OpenWhatsappResultDTO>(
        `${base(workspaceId)}/whatsapp`,
        json(target),
        'Não foi possível abrir a conversa no WhatsApp',
      ),
  })
}

const crm = (workspaceId: string, path: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/crm/${path}`

/** Quick actions of the zap context panel; each refreshes the 360 view. */
export function useCustomer360Actions(workspaceId: string) {
  const queryClient = useQueryClient()
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: customer360Keys.all(workspaceId) })

  const createLead = useMutation({
    mutationFn: (input: { name: string; phone: string }) =>
      apiFetch<{ id: string }>(
        crm(workspaceId, 'leads'),
        json({
          name: input.name,
          phones: [input.phone],
          source: 'WhatsApp',
          channel: 'WhatsApp',
        }),
        'Não foi possível criar o lead',
      ),
    onSuccess: refresh,
  })

  const createOpportunity = useMutation({
    mutationFn: (input: {
      name: string
      companyId?: string
      pointOfContactId?: string
    }) =>
      apiFetch<{ id: string }>(
        crm(workspaceId, 'opportunities'),
        json({ ...input, source: 'WhatsApp' }),
        'Não foi possível criar a oportunidade',
      ),
    onSuccess: refresh,
  })

  const createTask = useMutation({
    mutationFn: (input: {
      title: string
      personId?: string
      companyId?: string
      opportunityId?: string
    }) =>
      apiFetch<{ id: string }>(
        crm(workspaceId, 'tasks'),
        json(input),
        'Não foi possível criar a tarefa',
      ),
    onSuccess: refresh,
  })

  return { createLead, createOpportunity, createTask }
}
