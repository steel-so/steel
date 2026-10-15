import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { CrmDashboardTvService } from '@/src/services/crm-dashboard-tv.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

/**
 * Boot data of a TV link (`/tv/<token>`): no session, the token is the
 * credential. Revoked or broken links answer `CRM_TV_LINK_NOT_FOUND`.
 */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const limit = await consume(apiLimiter, `tv:${getClientIp(request)}`)
  if (!limit.ok) return handleError(limit.error)

  const { token } = await ctx.params
  const result = await CrmDashboardTvService.boot(token)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
