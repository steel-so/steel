import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { SteelAgentGovernanceService } from '@/src/services/steel-agent-governance.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Turns the emergency switch off; agents run again on their next trigger. */
export const POST = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/agents/governance/resume',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id } = await ctx.params
  const result = await SteelAgentGovernanceService.resume(
    auth.value.user.id,
    id,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
