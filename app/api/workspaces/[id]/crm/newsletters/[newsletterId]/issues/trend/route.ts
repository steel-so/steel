import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmNewsletterIssueService } from '@/src/services/crm-newsletter-issue.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; newsletterId: string }>
}

/** Open/click rates of the last sent issues (newsletter overview). */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, newsletterId } = await ctx.params
  const result = await CrmNewsletterIssueService.trend(
    auth.value.user.id,
    id,
    newsletterId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
