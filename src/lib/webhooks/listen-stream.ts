import type { WebhookEventType } from './events'
import type { WebhookRealtimeMessage } from './realtime'
import { signWebhookPayload } from './signature'

/**
 * SSE body of `GET /api/v1/webhooks/listen` (`steel listen`, ADR 0036).
 *
 * - `event: ready` — `{ workspaceId, events, secret }`: the secret the CLI
 *   (and the local app) use to check the signatures of this feed;
 * - `event: webhook` (with `id:` = event id) — `{ id, timestamp, signature,
 *   body }`: the exact body plus the three values of the `Steel-Webhook-*`
 *   headers, so the CLI forwards the request byte for byte;
 * - a `: ping` comment every 25 s keeps proxies from closing the stream.
 */

export const LISTEN_HEARTBEAT_MS = 25_000

export interface WebhookListenFrame {
  id: string
  timestamp: number
  signature: string
  body: string
}

export function webhookListenFrame(
  message: WebhookRealtimeMessage,
  secret: string,
  nowMs: number = Date.now(),
): WebhookListenFrame {
  const timestamp = Math.floor(nowMs / 1000)
  return {
    id: message.id,
    timestamp,
    signature: signWebhookPayload(secret, timestamp, message.body),
    body: message.body,
  }
}

export function createWebhookListenStream(input: {
  workspaceId: string
  secret: string
  events: WebhookEventType[]
  accepts: (type: WebhookEventType) => boolean
  subscribe: (
    onMessage: (message: WebhookRealtimeMessage) => void,
  ) => () => void
  heartbeatMs?: number
  now?: () => number
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closed = false

  const stop = () => {
    closed = true
    unsubscribe?.()
    unsubscribe = undefined
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = undefined
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          stop()
        }
      }

      send(
        `event: ready\ndata: ${JSON.stringify({
          workspaceId: input.workspaceId,
          events: input.events,
          secret: input.secret,
        })}\n\n`,
      )

      unsubscribe = input.subscribe((message) => {
        if (!input.accepts(message.type)) return
        const frame = webhookListenFrame(
          message,
          input.secret,
          (input.now ?? Date.now)(),
        )
        send(
          `event: webhook\nid: ${frame.id}\ndata: ${JSON.stringify(frame)}\n\n`,
        )
      })

      heartbeat = setInterval(
        () => send(': ping\n\n'),
        input.heartbeatMs ?? LISTEN_HEARTBEAT_MS,
      )
    },
    cancel() {
      stop()
    },
  })
}
