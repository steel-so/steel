import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { SteelAgentVersionService } from '@/src/services/steel-agent-version.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; agentId: string }> }

/** Versions of an agent with the real-run metrics used by the A/B view. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, agentId } = await ctx.params
  const result = await SteelAgentVersionService.list(
    auth.value.user.id,
    id,
    agentId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
