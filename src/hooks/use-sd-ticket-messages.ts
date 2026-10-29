import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  SdMessageVisibilityDTO,
  SdTicketAttachmentDTO,
  SdTicketMessageDTO,
  SdTicketMessagePageDTO,
} from '@/types/sd-ticket-message'
import { apiFetch, apiSend } from './_fetch'
import { sdJson, sdTicketTabKey, sdTicketTabUrl } from './_sd-ticket-tab'

export interface SendSdTicketMessageInput {
  body: string
  visibility?: SdMessageVisibilityDTO
  attachmentIds?: string[]
  /** Agentes citados com `@` (dispara `ticket.mentioned`). */
  mentionedUserIds?: string[]
  /** Steel Agents citados com `@` (cada um é acionado com o chamado). */
  mentionedAgentIds?: string[]
}

/**
 * Histórico (chat) do chamado. Páginas das mais novas para as mais antigas;
 * cada página vem em ordem cronológica — junte com `flattenSdMessages`.
 */
export function useSdTicketMessages(
  workspaceId: string,
  ticketRef: string,
  limit = 50,
) {
  return useInfiniteQuery({
    queryKey: sdTicketTabKey(workspaceId, ticketRef, 'messages'),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiFetch<SdTicketMessagePageDTO>(
        `${sdTicketTabUrl(workspaceId, ticketRef, 'messages')}?limit=${limit}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`,
        undefined,
        'Erro ao carregar o histórico',
      ),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: Boolean(workspaceId && ticketRef),
  })
}

/** Páginas (novas → antigas) em uma lista cronológica única. */
export function flattenSdMessages(
  pages: SdTicketMessagePageDTO[] | undefined,
): SdTicketMessageDTO[] {
  if (!pages) return []
  return [...pages].reverse().flatMap((page) => page.items)
}

function useInvalidate(workspaceId: string, ticketRef: string) {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({
        queryKey: sdTicketTabKey(workspaceId, ticketRef, 'messages'),
      }),
      qc.invalidateQueries({
        queryKey: sdTicketTabKey(workspaceId, ticketRef, 'attachments'),
      }),
    ])
}

export function useSendSdTicketMessage(workspaceId: string, ticketRef: string) {
  const invalidate = useInvalidate(workspaceId, ticketRef)
  return useMutation({
    mutationFn: (input: SendSdTicketMessageInput) =>
      apiFetch<SdTicketMessageDTO>(
        sdTicketTabUrl(workspaceId, ticketRef, 'messages'),
        sdJson('POST', input),
        'Erro ao enviar a mensagem',
      ),
    onSuccess: invalidate,
  })
}

export function useUpdateSdTicketMessage(
  workspaceId: string,
  ticketRef: string,
) {
  const invalidate = useInvalidate(workspaceId, ticketRef)
  return useMutation({
    mutationFn: ({ messageId, body }: { messageId: string; body: string }) =>
      apiFetch<SdTicketMessageDTO>(
        `${sdTicketTabUrl(workspaceId, ticketRef, 'messages')}/${messageId}`,
        sdJson('PATCH', { body }),
        'Erro ao editar a mensagem',
      ),
    onSuccess: invalidate,
  })
}

export function useDeleteSdTicketMessage(
  workspaceId: string,
  ticketRef: string,
) {
  const invalidate = useInvalidate(workspaceId, ticketRef)
  return useMutation({
    mutationFn: (messageId: string) =>
      apiSend(
        `${sdTicketTabUrl(workspaceId, ticketRef, 'messages')}/${messageId}`,
        { method: 'DELETE' },
        'Erro ao excluir a mensagem',
      ),
    onSuccess: invalidate,
  })
}

/** Anexos visíveis do chamado (galeria). */
export function useSdTicketAttachments(workspaceId: string, ticketRef: string) {
  return useQuery({
    queryKey: sdTicketTabKey(workspaceId, ticketRef, 'attachments'),
    queryFn: () =>
      apiFetch<SdTicketAttachmentDTO[]>(
        sdTicketTabUrl(workspaceId, ticketRef, 'attachments'),
        undefined,
        'Erro ao carregar os anexos',
      ),
    enabled: Boolean(workspaceId && ticketRef),
  })
}

/** Envia um arquivo (multipart, campo `file`) — ainda solto da mensagem. */
export function useUploadSdTicketAttachment(
  workspaceId: string,
  ticketRef: string,
) {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return apiFetch<SdTicketAttachmentDTO>(
        sdTicketTabUrl(workspaceId, ticketRef, 'attachments'),
        { method: 'POST', body: form },
        'Erro ao enviar o arquivo',
      )
    },
  })
}

export function useDeleteSdTicketAttachment(
  workspaceId: string,
  ticketRef: string,
) {
  const invalidate = useInvalidate(workspaceId, ticketRef)
  return useMutation({
    mutationFn: (attachmentId: string) =>
      apiSend(
        `${sdTicketTabUrl(workspaceId, ticketRef, 'attachments')}/${attachmentId}`,
        { method: 'DELETE' },
        'Erro ao remover o anexo',
      ),
    onSuccess: invalidate,
  })
}
