'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  SdTicketSourceCreatedDTO,
  SdTicketSourceKindDTO,
  SdTicketSourceLinkDTO,
  SdTicketSourcePrefillDTO,
} from '@/types/sd-ticket-source'
import { apiFetch, apiFetchJson } from './_fetch'

/**
 * Open a ServiceDesk ticket from a zap conversation or a CRM lead, person or
 * opportunity, and list the tickets already linked to one of them.
 */

const KEY = 'sd-ticket-source'

export interface CreateTicketFromSourceInput {
  source: SdTicketSourceKindDTO
  sourceId: string
  type?: 'INCIDENT' | 'SERVICE_REQUEST' | 'CHANGE' | 'PROBLEM'
  title?: string
  note?: string
  includeMessages?: boolean
  messageCount?: number
  allowDuplicate?: boolean
}

function base(workspaceId: string): string {
  return `/api/workspaces/${workspaceId}/servicedesk/tickets`
}

function query(source: SdTicketSourceKindDTO, sourceId: string): string {
  const params = new URLSearchParams({ source, sourceId })
  return `?${params.toString()}`
}

/**
 * Tickets linked to the source. `enabled` should be false when the viewer has
 * no ServiceDesk access (the endpoint answers 403 and nothing is shown).
 */
export function useSdTicketsBySource(
  workspaceId: string,
  source: SdTicketSourceKindDTO,
  sourceId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: [KEY, workspaceId, 'list', source, sourceId],
    queryFn: () =>
      apiFetch<SdTicketSourceLinkDTO[]>(
        `${base(workspaceId)}/by-source${query(source, sourceId ?? '')}`,
        undefined,
        'Erro ao buscar os chamados',
      ),
    enabled: Boolean(workspaceId && sourceId && enabled),
    retry: false,
  })
}

/** Prefill of the dialog (loaded only while it is open). */
export function useSdTicketSourcePrefill(
  workspaceId: string,
  source: SdTicketSourceKindDTO,
  sourceId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [KEY, workspaceId, 'prefill', source, sourceId],
    queryFn: () =>
      apiFetch<SdTicketSourcePrefillDTO>(
        `${base(workspaceId)}/from-source${query(source, sourceId)}`,
        undefined,
        'Erro ao preparar o chamado',
      ),
    enabled: Boolean(workspaceId && sourceId && enabled),
    retry: false,
    // The dialog is a one-shot form: always read fresh data when it opens.
    gcTime: 0,
  })
}

export function useCreateSdTicketFromSource(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTicketFromSourceInput) =>
      apiFetchJson<SdTicketSourceCreatedDTO>(
        `${base(workspaceId)}/from-source`,
        'POST',
        input,
        'Erro ao criar o chamado',
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] })
    },
  })
}
