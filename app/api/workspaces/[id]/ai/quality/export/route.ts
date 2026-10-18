import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { AiQualityExportQuerySchema } from '@/src/schemas/ai-feedback.schema'
import { AiQualityService } from '@/src/services/ai-quality.service'
import { handleError, standardError } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/**
 * CSV of the AI quality panel, streamed: feedback rows page by page, or
 * totals per surface or model. Errors before the first byte use the JSON
 * envelope; a database failure mid-stream aborts the download.
 */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const query = AiQualityExportQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  )
  if (!query.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      query.error.issues,
    )
  }

  const { id } = await ctx.params
  const result = await AiQualityService.exportCsv(
    auth.value.user.id,
    id,
    query.data,
  )
  if (!result.ok) return handleError(result.error)

  const { chunks, filename } = result.value
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next()
        if (next.done) controller.close()
        else controller.enqueue(encoder.encode(next.value))
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      await chunks.return(undefined)
    },
  })

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
})
