import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WorkspaceAccessLogExportQuerySchema } from '@/src/schemas/workspace-access-log.schema'
import { WorkspaceAccessLogService } from '@/src/services/workspace-access-log.service'
import { csvStreamResponse } from '@/utils/csv-stream-response'
import { handleError, standardError } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Admin workspace panel: the entry log as CSV (streamed, audited). */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const query = WorkspaceAccessLogExportQuerySchema.safeParse(
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
  const result = await WorkspaceAccessLogService.adminExportCsv(
    auth.value.user.id,
    id,
    query.data,
  )
  if (!result.ok) return handleError(result.error)
  return csvStreamResponse(result.value.chunks, result.value.filename)
})
