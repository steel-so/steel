import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { guardDocumentPublicRequest } from '@/src/lib/documents/public-request'
import { DocumentPublicService } from '@/src/services/document-public.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

/** Public link (no session; the token is the access). */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const guard = await guardDocumentPublicRequest(request)
  if (!guard.ok) return handleError(guard.error)

  const { token } = await ctx.params
  const result = await DocumentPublicService.getByToken(token)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
