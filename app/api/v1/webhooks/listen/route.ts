import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { createWebhookListenStream } from '@/src/lib/webhooks/listen-stream'
import { subscribeWebhookEvents } from '@/src/lib/webhooks/realtime'
import {
  authorizeWebhookV1,
  webhookApiContext,
} from '@/src/lib/webhooks/v1-route'
import { ListenWebhookQuerySchema } from '@/src/schemas/webhook.schema'
import { WebhookService } from '@/src/services/webhook.service'
import { handleError, standardError } from '@/utils/http-response'

/**
 * `steel listen` (ADR 0036): Server-Sent Events with the workspace's
 * webhook events, signed with the member's listen secret. `?events=a,b`
 * narrows the feed; the token's modules always apply.
 */
export const GET = withAxiom(async (request: NextRequest) => {
  const session = await authorizeWebhookV1(request)
  if (!session.ok) return handleError(session.error)

  const query = ListenWebhookQuerySchema.safeParse({
    events: new URL(request.url).searchParams.get('events') ?? undefined,
  })
  if (!query.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      query.error.issues,
    )
  }

  const listen = await WebhookService.openListen(
    session.value.userId,
    session.value.workspaceId,
    query.data.events,
    webhookApiContext(session.value),
  )
  if (!listen.ok) return handleError(listen.error)

  const workspaceId = session.value.workspaceId
  const stream = createWebhookListenStream({
    workspaceId,
    secret: listen.value.secret,
    events: listen.value.events,
    accepts: listen.value.accepts,
    subscribe: (onMessage) => subscribeWebhookEvents(workspaceId, onMessage),
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})
