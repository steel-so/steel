import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmNewsletterSubscriberService } from '@/src/services/crm-newsletter-subscriber.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; newsletterId: string; subscriberId: string }>
}

export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/crm/newsletters/[newsletterId]/subscribers/[subscriberId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, newsletterId, subscriberId } = await ctx.params
  const result = await CrmNewsletterSubscriberService.remove(
    auth.value.user.id,
    id,
    newsletterId,
    subscriberId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(null)
})
