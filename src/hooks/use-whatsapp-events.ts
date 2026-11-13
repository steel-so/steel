import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { WhatsAppBoletoChargeDTO } from '@/types/whatsapp-boleto'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import type { WhatsAppPhoneCallDTO } from '@/types/whatsapp-phone-call'
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

/** `reconnecting` = the live stream dropped; data is polled meanwhile. */
export type WhatsAppRealtimeStatus = 'connecting' | 'open' | 'reconnecting'

/** Poll interval while the live stream is down. */
export const REALTIME_FALLBACK_POLL_MS = 15_000
/** Wait before reopening a stream the browser gave up on. */
export const REALTIME_RECONNECT_MS = 5_000

export function useWhatsAppRealtimeEvents(
  workspaceId: string,
): WhatsAppRealtimeStatus {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<WhatsAppRealtimeStatus>('connecting')

  useEffect(() => {
    if (!workspaceId) return

    let source: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let disposed = false
    let wasDown = false

    // Whatever arrived while the stream was down is fetched in one go.
    const refetchAll = () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-conversations', workspaceId],
      })
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-messages', workspaceId],
      })
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-group-messages', workspaceId],
      })
    }

    const startPolling = () => {
      if (pollTimer === undefined) {
        pollTimer = setInterval(refetchAll, REALTIME_FALLBACK_POLL_MS)
      }
    }
    const stopPolling = () => {
      if (pollTimer !== undefined) {
        clearInterval(pollTimer)
        pollTimer = undefined
      }
    }

    const connect = () => {
      if (disposed) return
      const next = new EventSource(
        `/api/whatsapp/events?workspaceId=${workspaceId}`,
      )
      source = next
      bind(next)
    }

    function bind(stream: EventSource) {
      stream.onopen = () => {
        stopPolling()
        if (wasDown) {
          wasDown = false
          refetchAll()
        }
        setStatus('open')
      }

      stream.onerror = () => {
        wasDown = true
        setStatus('reconnecting')
        startPolling()
        // The browser retries on its own while CONNECTING; once it gave up
        // (CLOSED: e.g. the server dropped us) open a new stream.
        if (stream.readyState === 2 && reconnectTimer === undefined) {
          stream.close()
          reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined
            connect()
          }, REALTIME_RECONNECT_MS)
        }
      }

      stream.onmessage = (event) => {
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
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      stopPolling()
      source?.close()
    }
  }, [workspaceId, queryClient])

  return status
}
