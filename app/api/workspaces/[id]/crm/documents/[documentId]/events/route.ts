import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { DocumentService } from '@/src/services/document.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; documentId: string }> }

/** Timeline of the document (sent, opened, accepted...). */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, documentId } = await ctx.params
  const result = await DocumentService.listEvents(
    auth.value.user.id,
    id,
    documentId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
