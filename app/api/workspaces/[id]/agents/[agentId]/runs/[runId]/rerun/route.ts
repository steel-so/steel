import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { SteelAgentService } from '@/src/services/steel-agent.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; agentId: string; runId: string }>
}

/**
 * "Reexecutar como teste": queues a test run (202) with the trigger and
 * input of an earlier run. Reads run for real; every write is simulated.
 */
export const POST = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/agents/[agentId]/runs/[runId]/rerun',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, agentId, runId } = await ctx.params
  const result = await SteelAgentService.rerunAsTest(
    auth.value.user.id,
    id,
    agentId,
    runId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 202)
})
