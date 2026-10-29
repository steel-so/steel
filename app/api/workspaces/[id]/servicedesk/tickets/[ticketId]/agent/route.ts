import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { AssignSteelAgentSchema } from '@/src/schemas/steel-agent.schema'
import { SteelAgentAssignmentService } from '@/src/services/steel-agent-assignment.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; ticketId: string }> }

/** Steel Agent currently assigned to the ticket. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, ticketId } = await ctx.params
  const result = await SteelAgentAssignmentService.get(
    auth.value.user.id,
    id,
    'SD_TICKET',
    ticketId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Hands the ticket to a Steel Agent (`agentId: null` removes it). */
export const PUT = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PUT /api/workspaces/[id]/servicedesk/tickets/[ticketId]/agent',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id, ticketId }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = AssignSteelAgentSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await SteelAgentAssignmentService.assign(
    auth.value.user.id,
    id,
    'SD_TICKET',
    ticketId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
