import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { CrmNewsletterPollService } from '@/src/services/crm-newsletter-poll.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

/**
 * Records the vote of a newsletter poll option (nl2-engage). No session:
 * the signed token (delivery + block + option) is the authorization (route
 * in PUBLIC_ROUTES under `/api/newsletters`). The page
 * `/newsletter/enquete/<token>` posts here after it loads, so a link
 * scanner that only GETs the page never votes. Voting again swaps the
 * option.
 */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const limit = await consume(apiLimiter, `ip:${getClientIp(request)}`)
  if (!limit.ok) return handleError(limit.error)

  const { token } = await ctx.params
  const result = await CrmNewsletterPollService.vote(token, new Date())
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
