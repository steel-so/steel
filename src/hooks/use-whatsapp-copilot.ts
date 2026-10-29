import { useMutation } from '@tanstack/react-query'
import type {
  WhatsAppCopilotRewriteDTO,
  WhatsAppCopilotSuggestionDTO,
  WhatsAppCopilotSummaryDTO,
  WhatsAppCopilotToneDTO,
} from '@/types/whatsapp-copilot'
import { apiFetch } from './_fetch'

const base = (workspaceId: string, conversationId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/conversations/${conversationId}/copilot`

function post<T>(url: string, body: unknown, fallback: string) {
  return apiFetch<T>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    fallback,
  )
}

/** Z7: a reply the agent can edit and send. Nothing is sent by the call. */
export function useSuggestWhatsAppCopilotReply(
  workspaceId: string,
  conversationId: string,
) {
  return useMutation({
    mutationFn: (data: { hint?: string } = {}) =>
      post<WhatsAppCopilotSuggestionDTO>(
        `${base(workspaceId, conversationId)}/suggest`,
        data,
        'Erro ao sugerir resposta',
      ),
  })
}

/** Z7: summary + open items, for the agent taking over a conversation. */
export function useSummarizeWhatsAppConversation(
  workspaceId: string,
  conversationId: string,
) {
  return useMutation({
    mutationFn: () =>
      post<WhatsAppCopilotSummaryDTO>(
        `${base(workspaceId, conversationId)}/summary`,
        {},
        'Erro ao resumir a conversa',
      ),
  })
}

/** Z7: rewrites the draft in another tone. */
export function useAdjustWhatsAppCopilotTone(
  workspaceId: string,
  conversationId: string,
) {
  return useMutation({
    mutationFn: (data: { text: string; tone: WhatsAppCopilotToneDTO }) =>
      post<WhatsAppCopilotRewriteDTO>(
        `${base(workspaceId, conversationId)}/tone`,
        data,
        'Erro ao ajustar o tom',
      ),
  })
}
