'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { z } from 'zod'
import type {
  AddSdMajorIncidentUpdateSchema,
  DeclareSdMajorIncidentSchema,
  LinkSdMajorIncidentTicketsInput,
  ResolveSdMajorIncidentSchema,
  UpdateSdMajorIncidentInput,
} from '@/src/schemas/sd-major-incident.schema'
import type {
  SdMajorIncidentDeclareDTO,
  SdMajorIncidentDTO,
  SdMajorIncidentLinkResultDTO,
  SdMajorIncidentListDTO,
  SdMajorIncidentSuggestionListDTO,
  SdTicketMajorIncidentDTO,
} from '@/types/sd-major-incident'
import { apiFetch, apiSend } from './_fetch'
import { sdBase, sdJson, sdQueryString } from './_sd-directory'
import { sdTicketTabKey, sdTicketTabUrl } from './_sd-ticket-tab'

/**
 * Incidente maior do ServiceDesk (S2). Tudo sob `['sd-major-incidents', ws]`;
 * a aba do chamado usa a chave de aba do chamado (`major-incident`), então o
 * SSE do chamado também a recarrega.
 */

export const sdMajorIncidentKeys = {
  all: (workspaceId: string) => ['sd-major-incidents', workspaceId] as const,
}

function useInvalidate(workspaceId: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: sdMajorIncidentKeys.all(workspaceId),
    })
    queryClient.invalidateQueries({ queryKey: ['sd-tickets', workspaceId] })
  }
}

export function useSdMajorIncidents(
  workspaceId: string,
  status: 'ACTIVE' | 'RESOLVED' | 'ALL' = 'ACTIVE',
) {
  return useQuery({
    queryKey: [...sdMajorIncidentKeys.all(workspaceId), 'list', status],
    queryFn: () =>
      apiFetch<SdMajorIncidentListDTO>(
        `${sdBase(workspaceId, 'major-incidents')}${sdQueryString({ status })}`,
        undefined,
        'Erro ao carregar os incidentes maiores',
      ),
    enabled: !!workspaceId,
    refetchInterval: 30_000,
  })
}

export function useSdMajorIncident(
  workspaceId: string,
  incidentId: string | null,
) {
  return useQuery({
    queryKey: [...sdMajorIncidentKeys.all(workspaceId), 'item', incidentId],
    queryFn: () =>
      apiFetch<SdMajorIncidentDTO>(
        sdBase(workspaceId, `major-incidents/${incidentId}`),
        undefined,
        'Erro ao carregar o incidente maior',
      ),
    enabled: !!workspaceId && !!incidentId,
    refetchInterval: 20_000,
  })
}

export function useSdMajorIncidentSuggestions(
  workspaceId: string,
  incidentId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      ...sdMajorIncidentKeys.all(workspaceId),
      'suggestions',
      incidentId,
    ],
    queryFn: () =>
      apiFetch<SdMajorIncidentSuggestionListDTO>(
        sdBase(workspaceId, `major-incidents/${incidentId}/suggestions`),
        undefined,
        'Erro ao carregar as sugestões',
      ),
    enabled: !!workspaceId && !!incidentId && enabled,
  })
}

/** What the ticket screen needs (its incident and the one it belongs to). */
export function useSdTicketMajorIncident(
  workspaceId: string,
  ticketRef: string,
) {
  return useQuery({
    queryKey: sdTicketTabKey(workspaceId, ticketRef, 'major-incident'),
    queryFn: () =>
      apiFetch<SdTicketMajorIncidentDTO>(
        sdTicketTabUrl(workspaceId, ticketRef, 'major-incident'),
        undefined,
        'Erro ao carregar o incidente maior do chamado',
      ),
    enabled: !!workspaceId && !!ticketRef,
  })
}

export function useDeclareSdMajorIncident(workspaceId: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (input: z.input<typeof DeclareSdMajorIncidentSchema>) =>
      apiFetch<SdMajorIncidentDeclareDTO>(
        sdBase(workspaceId, 'major-incidents'),
        sdJson('POST', input),
        'Erro ao declarar o incidente maior',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateSdMajorIncident(workspaceId: string, id: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (input: UpdateSdMajorIncidentInput) =>
      apiFetch<SdMajorIncidentDTO>(
        sdBase(workspaceId, `major-incidents/${id}`),
        sdJson('PATCH', input),
        'Erro ao salvar o incidente maior',
      ),
    onSuccess: invalidate,
  })
}

export function useAddSdMajorIncidentUpdate(workspaceId: string, id: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (input: z.input<typeof AddSdMajorIncidentUpdateSchema>) =>
      apiFetch<SdMajorIncidentDTO>(
        sdBase(workspaceId, `major-incidents/${id}/updates`),
        sdJson('POST', input),
        'Erro ao publicar a atualização',
      ),
    onSuccess: invalidate,
  })
}

export function useResolveSdMajorIncident(workspaceId: string, id: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (input: z.input<typeof ResolveSdMajorIncidentSchema>) =>
      apiFetch<SdMajorIncidentDTO>(
        sdBase(workspaceId, `major-incidents/${id}/resolve`),
        sdJson('POST', input),
        'Erro ao resolver o incidente maior',
      ),
    onSuccess: invalidate,
  })
}

export function useLinkSdMajorIncidentTickets(workspaceId: string, id: string) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (input: LinkSdMajorIncidentTicketsInput) =>
      apiFetch<SdMajorIncidentLinkResultDTO>(
        sdBase(workspaceId, `major-incidents/${id}/tickets`),
        sdJson('POST', input),
        'Erro ao vincular os chamados',
      ),
    onSuccess: invalidate,
  })
}

export function useUnlinkSdMajorIncidentTicket(
  workspaceId: string,
  id: string,
) {
  const invalidate = useInvalidate(workspaceId)
  return useMutation({
    mutationFn: (ticketId: string) =>
      apiSend(
        sdBase(workspaceId, `major-incidents/${id}/tickets/${ticketId}`),
        { method: 'DELETE' },
        'Erro ao desvincular o chamado',
      ),
    onSuccess: invalidate,
  })
}
