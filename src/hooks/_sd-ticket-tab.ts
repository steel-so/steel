/**
 * Base das abas do chamado (mensagens, tarefas, custos, peças, aprovações,
 * assinaturas). As chaves ficam sob `['sd-tickets', ws, …]` para que o SSE
 * (`useSdTicketRealtime`, que invalida `sdTicketKeys.all`) recarregue as
 * abas sozinho a cada evento do chamado.
 */

export type SdTicketTabFeature =
  | 'messages'
  | 'attachments'
  | 'tasks'
  | 'costs'
  | 'parts'
  | 'approvals'
  | 'approval-rounds'
  | 'change-schedule'
  | 'signatures'
  | 'time-entries'
  | 'swarms'

export function sdTicketTabKey(
  workspaceId: string,
  ticketRef: string,
  feature: SdTicketTabFeature,
) {
  return ['sd-tickets', workspaceId, feature, ticketRef] as const
}

export function sdTicketTabUrl(
  workspaceId: string,
  ticketRef: string,
  feature: SdTicketTabFeature,
): string {
  return `/api/workspaces/${workspaceId}/servicedesk/tickets/${encodeURIComponent(ticketRef)}/${feature}`
}

export function sdJson(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}
