import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmHealthService } from '@/src/services/crm-health.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; opportunityId: string }> }

/** Health of one open deal; computed on the spot the first time. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, opportunityId } = await ctx.params
  const result = await CrmHealthService.getOpportunityHealth(
    auth.value.user.id,
    id,
    opportunityId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Recomputes the deal health now (and alerts if it entered the high band). */
export const POST = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/crm/health/opportunities/[opportunityId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, opportunityId } = await ctx.params
  const result = await CrmHealthService.recomputeOpportunityHealth(
    auth.value.user.id,
    id,
    opportunityId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
