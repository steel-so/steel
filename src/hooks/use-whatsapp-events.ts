import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import type { WhatsAppPhoneCallDTO } from '@/types/whatsapp-phone-call'
import type { WhatsAppBoletoChargeDTO } from '@/types/whatsapp-boleto'
import type { WhatsAppPixChargeDTO } from '@/types/whatsapp-pix'
import { phoneCallsKey } from './use-phone-calls'

type WhatsAppRealtimeEvent =
  | {
      type: 'message.created'
      conversationId: string
      message: WhatsAppMessageDTO
    }
  | {
      type: 'message.updated'
      conversationId: string
      message: WhatsAppMessageDTO
    }
  | { type: 'message.deleted'; conversationId: string; messageId: string }
  | { type: 'conversation.updated'; conversation: WhatsAppConversationDTO }
  | { type: 'conversation.deleted'; conversationId: string }
  | { type: 'group-message.created'; groupId: string }
  | { type: 'phone-call.updated'; call: WhatsAppPhoneCallDTO }
  | {
      type: 'pix-charge.updated'
      conversationId: string
      charge: WhatsAppPixChargeDTO
    }
  | {
      type: 'boleto-charge.updated'
      conversationId: string
      charge: WhatsAppBoletoChargeDTO
    }

export function useWhatsAppRealtimeEvents(workspaceId: string) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!workspaceId) return

    const source = new EventSource(
      `/api/whatsapp/events?workspaceId=${workspaceId}`,
    )

    source.onmessage = (event) => {
      let parsed: WhatsAppRealtimeEvent
      try {
        parsed = JSON.parse(event.data)
      } catch {
        return
      }

      if (
        parsed.type === 'message.created' ||
        parsed.type === 'message.updated' ||
        parsed.type === 'message.deleted'
      ) {
        queryClient.invalidateQueries({
          queryKey: ['whatsapp-messages', workspaceId, parsed.conversationId],
        })
        queryClient.invalidateQueries({
          queryKey: ['whatsapp-conversations', workspaceId],
        })
      }

      if (
        parsed.type === 'conversation.updated' ||
        parsed.type === 'conversation.deleted'
      ) {
        queryClient.invalidateQueries({
          queryKey: ['whatsapp-conversations', workspaceId],
        })
      }

      // Fechar/reabrir (inclusive automático) gera evento na linha do tempo.
      if (parsed.type === 'conversation.updated') {
        queryClient.invalidateQueries({
          queryKey: [
            'whatsapp-conversation-events',
            workspaceId,
            parsed.conversation.id,
          ],
        })
      }

      if (parsed.type === 'phone-call.updated') {
        if (parsed.call.conversationId) {
          queryClient.setQueryData(
            ['whatsapp-phone-call', workspaceId, parsed.call.conversationId],
            parsed.call,
          )
        }
        // Recording / transcript / summary landed: refresh the call cards.
        queryClient.invalidateQueries({ queryKey: phoneCallsKey(workspaceId) })
      }

      if (parsed.type === 'pix-charge.updated') {
        queryClient.invalidateQueries({
          queryKey: ['whatsapp-pix-charges', workspaceId],
        })
        // A payment adds a PIX_PAID chip to the conversation timeline.
        queryClient.invalidateQueries({
          queryKey: ['whatsapp-conversation-events', workspaceId],
        })
        queryClient.invalidateQueries({
          queryKey: ['crm-opportunity-pix', workspaceId],
        })
      }

      if (parsed.type === 'boleto-charge.updated') {
        queryClient.invalidateQueries({
          queryKey: ['whatsapp-boleto-charges', workspaceId],
        })
      }

      if (parsed.type === 'group-message.created') {
        queryClient.invalidateQueries({
          queryKey: ['whatsapp-group-messages', workspaceId, parsed.groupId],
        })
        queryClient.invalidateQueries({
          queryKey: ['whatsapp-groups', workspaceId],
        })
      }
    }

    return () => {
      source.close()
    }
  }, [workspaceId, queryClient])
}
