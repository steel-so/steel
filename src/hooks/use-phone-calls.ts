import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PhoneCallRecordDTO } from '@/types/whatsapp-phone-call'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'
import { sdTicketTabKey } from './_sd-ticket-tab'

/** Record whose timeline lists the calls (ADR 0043). */
export type PhoneCallSource =
  | { kind: 'conversation'; id: string }
  | { kind: 'ticket'; id: string }
  | { kind: 'crm-person'; id: string }
  | { kind: 'crm-opportunity'; id: string }

/** Every call list of the workspace shares this prefix (SSE invalidation). */
export const phoneCallsKey = (workspaceId: string) =>
  ['phone-calls', workspaceId] as const

function sourceUrl(workspaceId: string, source: PhoneCallSource): string {
  const base = `/api/workspaces/${workspaceId}`
  const id = encodeURIComponent(source.id)
  switch (source.kind) {
    case 'conversation':
      return `${base}/whatsapp/conversations/${id}/calls`
    case 'ticket':
      return `${base}/servicedesk/tickets/${id}/calls`
    case 'crm-person':
      return `${base}/crm/people/${id}/calls`
    case 'crm-opportunity':
      return `${base}/crm/opportunities/${id}/calls`
  }
}

/** URL the `<audio>` player streams the recording from. */
export function phoneCallRecordingUrl(
  workspaceId: string,
  callId: string,
): string {
  return `/api/workspaces/${workspaceId}/phone-calls/${encodeURIComponent(callId)}/recording`
}

/** Polls while a recording is still being transcribed. */
const PROCESSING_POLL_MS = 5_000

export function usePhoneCalls(
  workspaceId: string,
  source: PhoneCallSource,
  enabled = true,
) {
  return useQuery({
    queryKey: [...phoneCallsKey(workspaceId), source.kind, source.id],
    queryFn: () =>
      apiFetch<PhoneCallRecordDTO[]>(
        sourceUrl(workspaceId, source),
        undefined,
        'Erro ao carregar as ligações',
      ),
    enabled: enabled && Boolean(workspaceId && source.id),
    refetchInterval: (query) =>
      query.state.data?.some(
        (call) => call.aiStatus === 'PENDING' || call.aiStatus === 'PROCESSING',
      )
        ? PROCESSING_POLL_MS
        : false,
  })
}

export function useDeletePhoneCallRecording(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (callId: string) =>
      apiSend(
        phoneCallRecordingUrl(workspaceId, callId),
        { method: 'DELETE' },
        'Erro ao apagar a gravação',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: phoneCallsKey(workspaceId) }),
  })
}

/** Where "Criar tarefa" puts a next step of the call. */
export type PhoneCallTaskTarget =
  | { kind: 'ticket'; ticketRef: string }
  | { kind: 'crm'; personId: string | null; opportunityId: string | null }

/**
 * Creates a task from one next step of the call summary: a ticket task in
 * the ServiceDesk, or a CRM task on the person/opportunity.
 */
export function useCreateTaskFromCallStep(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      target,
      title,
      body,
    }: {
      target: PhoneCallTaskTarget
      title: string
      body?: string
    }) => {
      const base = `/api/workspaces/${workspaceId}`
      if (target.kind === 'ticket') {
        return apiFetchJson<unknown>(
          `${base}/servicedesk/tickets/${encodeURIComponent(target.ticketRef)}/tasks`,
          'POST',
          { title, description: body },
          'Erro ao criar a tarefa',
        )
      }
      return apiFetchJson<unknown>(
        `${base}/crm/tasks`,
        'POST',
        {
          title,
          body,
          ...(target.personId && { personId: target.personId }),
          ...(target.opportunityId && { opportunityId: target.opportunityId }),
        },
        'Erro ao criar a tarefa',
      )
    },
    onSuccess: (_data, { target }) => {
      // CRM lists fetch on mount (no shared cache); the ticket tab is cached.
      if (target.kind === 'ticket') {
        queryClient.invalidateQueries({
          queryKey: sdTicketTabKey(workspaceId, target.ticketRef, 'tasks'),
        })
      }
    },
  })
}
