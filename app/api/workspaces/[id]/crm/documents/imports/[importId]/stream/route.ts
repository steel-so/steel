import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { subscribeDocumentImport } from '@/src/lib/document-ai/realtime'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { DocumentImportService } from '@/src/services/document-import.service'
import type { DocumentImportDTO } from '@/types/document'
import { handleError } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; importId: string }> }

/** Re-reads the row this often (a frame lost between workers is healed). */
const RECHECK_MS = 15_000

const finished = (dto: DocumentImportDTO) =>
  dto.status === 'READY' || dto.status === 'FAILED'

/**
 * Live progress of an AI import as `text/event-stream`: one
 * `event: import` frame with the whole `DocumentImportDTO` now and after
 * every step (Redis pub/sub `documents:import:<id>`), `: ping` comments
 * every 15 s, and the stream closes once the import is READY or FAILED.
 * Same authorization as `GET .../imports/[importId]`.
 */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)
  const userId = auth.value.user.id

  const limit = await consume(apiLimiter, `user:${userId}`)
  if (!limit.ok) return handleError(limit.error)

  const { id: workspaceId, importId } = await ctx.params
  const initial = await DocumentImportService.get(userId, workspaceId, importId)
  if (!initial.ok) return handleError(initial.error)

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let open = true

  const stop = () => {
    open = false
    unsubscribe?.()
    unsubscribe = undefined
    if (timer) clearInterval(timer)
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          stop()
        }
      }
      const send = (dto: DocumentImportDTO) => {
        write(`event: import\ndata: ${JSON.stringify(dto)}\n\n`)
        if (!finished(dto) || !open) return
        stop()
        try {
          controller.close()
        } catch {
          // already closed by the client
        }
      }

      write(': connected\n\n')
      // Subscribe before sending the snapshot, so no step falls between.
      unsubscribe = subscribeDocumentImport(importId, send)
      send(initial.value)
      if (!open) return

      timer = setInterval(async () => {
        write(': ping\n\n')
        const latest = await DocumentImportService.get(
          userId,
          workspaceId,
          importId,
        )
        if (latest.ok && finished(latest.value)) send(latest.value)
      }, RECHECK_MS)
    },
    cancel() {
      stop()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx streams it whatever the location says (ADR 0038).
      'X-Accel-Buffering': 'no',
    },
  })
})
