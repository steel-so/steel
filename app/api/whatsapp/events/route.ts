import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { subscribeWhatsAppEvents } from '@/src/lib/whatsapp/realtime'
import { openWhatsAppRealtimeViewer } from '@/src/services/whatsapp-conversation-scope.service'
import { handleError } from '@/utils/http-response'

export const GET = withAxiom(async (request: NextRequest) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const { searchParams } = new URL(request.url)
  const workspaceId = searchParams.get('workspaceId')
  if (!workspaceId) {
    return new Response('workspaceId é obrigatório', { status: 400 })
  }

  // Module member + per-connection filter: each subscriber only receives
  // the events of the conversations it can see (Equipes).
  const viewer = await openWhatsAppRealtimeViewer(
    auth.value.user.id,
    workspaceId,
  )
  if (!viewer.ok) return handleError(viewer.error)
  const filter = viewer.value

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true
        }
      }
      send(': connected\n\n')

      // Filtering is async (a conversation lookup on a miss): chain it so
      // the events keep their publish order.
      let queue: Promise<void> = Promise.resolve()
      unsubscribe = subscribeWhatsAppEvents(workspaceId, (event) => {
        queue = queue
          .then(() => filter(event))
          .then((visible) => {
            if (visible) send(`data: ${JSON.stringify(visible)}\n\n`)
          })
          .catch(() => undefined)
      })

      heartbeat = setInterval(() => send(': ping\n\n'), 25000)
    },
    cancel() {
      closed = true
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
})
