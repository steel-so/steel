import 'server-only'
import { logger } from '@/lib/axiom/logger'
import { getQueueConnection } from '@/src/lib/queue/connection'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import type { WhatsAppPhoneCallDTO } from '@/types/whatsapp-phone-call'
import type { WhatsAppBoletoChargeDTO } from '@/types/whatsapp-boleto'
import type { WhatsAppPixChargeDTO } from '@/types/whatsapp-pix'

export type WhatsAppRealtimeEvent =
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

function channelForWorkspace(workspaceId: string): string {
  return `whatsapp:workspace:${workspaceId}`
}

export async function publishWhatsAppEvent(
  workspaceId: string,
  event: WhatsAppRealtimeEvent,
): Promise<void> {
  try {
    await getQueueConnection().publish(
      channelForWorkspace(workspaceId),
      JSON.stringify(event),
    )
  } catch (error) {
    logger.error('whatsapp.realtime.publish_failed', {
      workspaceId,
      eventType: event.type,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export function subscribeWhatsAppEvents(
  workspaceId: string,
  onEvent: (event: WhatsAppRealtimeEvent) => void,
): () => void {
  const subscriber = getQueueConnection().duplicate()
  const channel = channelForWorkspace(workspaceId)

  subscriber.subscribe(channel).catch((error) => {
    logger.error('whatsapp.realtime.subscribe_failed', {
      workspaceId,
      message: error instanceof Error ? error.message : String(error),
    })
  })

  subscriber.on('message', (receivedChannel, payload) => {
    if (receivedChannel !== channel) return
    try {
      onEvent(JSON.parse(payload) as WhatsAppRealtimeEvent)
    } catch {
      // ignore malformed payloads
    }
  })

  return () => {
    subscriber.unsubscribe(channel).finally(() => {
      subscriber.quit().catch(() => undefined)
    })
  }
}
