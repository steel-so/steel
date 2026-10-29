import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { guardPublicStatusRoute } from '@/src/lib/servicedesk/public-status-route'
import { SdStatusPageService } from '@/src/services/sd-status-page.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ slug: string }> }

/** Public status page (no session): the slug in the path is the access. */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const guard = await guardPublicStatusRoute(request, await ctx.params)
  if (!guard.ok) return handleError(guard.error)

  const result = await SdStatusPageService.getPublic(guard.value.slug)
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
