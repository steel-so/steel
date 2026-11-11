import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { DocumentExportService } from '@/src/services/document-export.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; documentId: string; exportId: string }>
}

/** Status of one export; `downloadUrl` once it is READY. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, documentId, exportId } = await ctx.params
  const result = await DocumentExportService.get(
    auth.value.user.id,
    id,
    documentId,
    exportId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
