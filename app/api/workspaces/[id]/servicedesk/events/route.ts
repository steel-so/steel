import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import {
  canReceiveSdTicketEvent,
  subscribeSdTicketEvents,
} from '@/src/lib/servicedesk/realtime'
import { SdAccess } from '@/src/services/sd-access'
import { handleError } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/**
 * SSE dos chamados do ServiceDesk (Redis pub/sub
 * `servicedesk:workspace:<id>`). Agentes recebem tudo; solicitantes só os
 * eventos não internos dos chamados em que são solicitante, participante
 * ou contato. Cada linha `data:` é um `SdTicketRealtimeEvent`.
 */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const { id: workspaceId } = await ctx.params
  const access = await SdAccess.resolve(auth.value.user.id, workspaceId, {
    resource: 'sd-tickets',
    action: 'VIEW',
  })
  if (!access.ok) return handleError(access.error)
  const viewer = { userId: access.value.userId, isAgent: access.value.isAgent }

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(': connected\n\n'))

      unsubscribe = subscribeSdTicketEvents(workspaceId, (event, audience) => {
        if (!canReceiveSdTicketEvent(viewer, event, audience)) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      })

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
      // nginx streams it whatever the location says (ADR 0037).
      'X-Accel-Buffering': 'no',
    },
  })
})
