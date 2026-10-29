import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { InviteSdSwarmSchema } from '@/src/schemas/sd-swarm.schema'
import { SdSwarmService } from '@/src/services/sd-swarm.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; ticketId: string; swarmId: string }>
}

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/servicedesk/tickets/[ticketId]/swarms/[swarmId]/invite',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id, ticketId, swarmId }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = InviteSdSwarmSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await SdSwarmService.invite(
    auth.value.user.id,
    id,
    ticketId,
    swarmId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
