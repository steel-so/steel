import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmHealthService } from '@/src/services/crm-health.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; companyId: string }> }

/** Health of one company; computed on the spot the first time. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, companyId } = await ctx.params
  const result = await CrmHealthService.getCustomerHealth(
    auth.value.user.id,
    id,
    companyId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Recomputes the company health now (and alerts if it entered the high band). */
export const POST = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/crm/health/companies/[companyId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, companyId } = await ctx.params
  const result = await CrmHealthService.recomputeCustomerHealth(
    auth.value.user.id,
    id,
    companyId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
