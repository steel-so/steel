import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { SteelAgentSimulationService } from '@/src/services/steel-agent-simulation.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; agentId: string; simulationId: string }>
}

export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, agentId, simulationId } = await ctx.params
  const result = await SteelAgentSimulationService.get(
    auth.value.user.id,
    id,
    agentId,
    simulationId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/agents/[agentId]/simulations/[simulationId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, agentId, simulationId } = await ctx.params
  const result = await SteelAgentSimulationService.delete(
    auth.value.user.id,
    id,
    agentId,
    simulationId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
