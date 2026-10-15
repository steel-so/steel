import type { SiteAiEvent } from '@/types/site-ai'

/**
 * `text/event-stream` of a site generation. Same framing as Steel AI
 * (`event: <type>\ndata: <json>\n\n`), plus a comment heartbeat while a
 * long provider call is running, so proxies (nginx, the homologação edge)
 * do not close an idle stream. The generation is drained to the end even
 * if the browser goes away: the site is still created.
 */

export const SITE_AI_HEARTBEAT_MS = 15_000

export function encodeSiteAiEvent(event: SiteAiEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export function siteAiSseResponse(
  events: AsyncIterable<SiteAiEvent>,
  onError?: (cause: unknown) => void,
  heartbeatMs = SITE_AI_HEARTBEAT_MS,
): Response {
  const encoder = new TextEncoder()
  let open = true
  let timer: ReturnType<typeof setInterval> | null = null

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          open = false
        }
      }
      timer = setInterval(() => write(': ping\n\n'), heartbeatMs)
      try {
        for await (const event of events) write(encodeSiteAiEvent(event))
      } catch (cause) {
        onError?.(cause)
        write(
          encodeSiteAiEvent({
            type: 'error',
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Não foi possível concluir a geração. Tente novamente.',
          }),
        )
      }
      if (timer) clearInterval(timer)
      if (open) {
        open = false
        controller.close()
      }
    },
    cancel() {
      open = false
    },
  })

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
