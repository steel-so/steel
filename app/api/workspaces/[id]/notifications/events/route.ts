import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { subscribeNotificationEvents } from '@/src/lib/notifications/realtime'
import { assertMember } from '@/src/services/authz'
import { handleError } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/**
 * SSE genérico da caixa de entrada (Redis pub/sub
 * `notifications:workspace:<id>`). Cada conexão recebe apenas os eventos
 * cujas notificações são do próprio usuário; a lista de destinatários nunca
 * chega ao navegador. Cada linha `data:` é um `NotificationRealtimeEvent`.
 */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const { id: workspaceId } = await ctx.params
  const membership = await assertMember(auth.value.user.id, workspaceId)
  if (!membership.ok) return handleError(membership.error)

  const userId = auth.value.user.id
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(': connected\n\n'))

      unsubscribe = subscribeNotificationEvents(
        workspaceId,
        (event, userIds) => {
          if (!userIds.includes(userId)) return
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          )
        },
      )

      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': ping\n\n'))
      }, 25000)
    },
    cancel() {
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx streams it whatever the location says (ADR 0038).
      'X-Accel-Buffering': 'no',
    },
  })
})
