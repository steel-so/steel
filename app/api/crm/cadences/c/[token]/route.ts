import { type NextRequest, NextResponse } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmCadenceTrackingService } from '@/src/services/crm-cadence-tracking.service'
import { handleError } from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

/**
 * Public click redirect of the cadence e-mail links (no session). The token
 * signs the run and the destination in `u`, so only links we wrote can be
 * followed. Records the click and redirects.
 */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const limit = await consume(
    apiLimiter,
    `ip:${request.headers.get('x-forwarded-for') ?? 'unknown'}`,
  )
  if (!limit.ok) return handleError(limit.error)

  const { token } = await ctx.params
  const url = request.nextUrl.searchParams.get('u') ?? ''
  const result = await CrmCadenceTrackingService.resolveClick(
    token,
    url,
    new Date(),
  )
  if (!result.ok) return handleError(result.error)

  return NextResponse.redirect(result.value, 302)
})
