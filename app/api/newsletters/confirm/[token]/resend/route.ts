import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, newsletterSubscribeIpLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { CrmNewsletterPublicService } from '@/src/services/crm-newsletter-public.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

/** "Link expired" page: sends a fresh confirmation e-mail. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const limit = await consume(
    newsletterSubscribeIpLimiter,
    `ip:${getClientIp(request)}`,
  )
  if (!limit.ok) return handleError(limit.error)

  const { token } = await ctx.params
  const result = await CrmNewsletterPublicService.resendConfirmation(
    token,
    new Date(),
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
