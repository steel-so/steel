import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { DocumentImportService } from '@/src/services/document-import.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; importId: string }> }

/** One AI import: status, progress and, when READY, the new document id. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, importId } = await ctx.params
  const result = await DocumentImportService.get(
    auth.value.user.id,
    id,
    importId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
