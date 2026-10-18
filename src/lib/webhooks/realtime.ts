import 'server-only'
import { logger } from '@/lib/axiom/logger'
import { getQueueConnection } from '@/src/lib/queue/connection'
import type { WebhookEventType } from './events'

/**
 * Live feed of the workspace's webhook events for `steel listen`
 * (`GET /api/v1/webhooks/listen`, ADR 0036), over Redis pub/sub like
 * `src/lib/whatsapp/realtime.ts`. The message carries the exact body; each
 * listener signs it with its own secret when forwarding.
 */

export interface WebhookRealtimeMessage {
  id: string
  type: WebhookEventType
  /** Exact JSON body of the event. */
  body: string
}

export function webhookChannel(workspaceId: string): string {
  return `webhooks:workspace:${workspaceId}`
}

export async function publishWebhookEvent(
  workspaceId: string,
  message: WebhookRealtimeMessage,
): Promise<void> {
  try {
    await getQueueConnection().publish(
      webhookChannel(workspaceId),
      JSON.stringify(message),
    )
  } catch (error) {
    logger.error('webhooks.realtime.publish_failed', {
      workspaceId,
      eventType: message.type,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export function subscribeWebhookEvents(
  workspaceId: string,
  onMessage: (message: WebhookRealtimeMessage) => void,
): () => void {
  const subscriber = getQueueConnection().duplicate()
  const channel = webhookChannel(workspaceId)

  subscriber.subscribe(channel).catch((error) => {
    logger.error('webhooks.realtime.subscribe_failed', {
      workspaceId,
      message: error instanceof Error ? error.message : String(error),
    })
  })

  subscriber.on('message', (receivedChannel, payload) => {
    if (receivedChannel !== channel) return
    try {
      onMessage(JSON.parse(payload) as WebhookRealtimeMessage)
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
