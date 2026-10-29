import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { GenerateSteelAgentScenariosSchema } from '@/src/schemas/steel-agent-simulation.schema'
import { SteelAgentSimulationService } from '@/src/services/steel-agent-simulation.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; agentId: string }> }

/** "Gerar cenários": scenario drafts proposed by the AI, nothing is saved. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/agents/[agentId]/simulations/generate',
  )
  if (!consent.ok) return handleError(consent.error)

  const body = await request.json().catch(() => ({}))
  const parsed = GenerateSteelAgentScenariosSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const { id, agentId } = await ctx.params
  const result = await SteelAgentSimulationService.generateScenarios(
    auth.value.user.id,
    id,
    agentId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
