import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { ToggleDealRoomActionSchema } from '@/src/schemas/crm-deals.schema'
import { CrmDealRoomService } from '@/src/services/crm-deal-room.service'
import { parseBody, publicIp } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ token: string; actionId: string }> }

/** The customer checks (or unchecks) a step of the plan that is theirs. */
export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = await publicIp(request, 'deal-room-action')
  if (!ip.ok) return handleError(ip.error)

  const { token, actionId } = await ctx.params
  const body = await parseBody(request, ToggleDealRoomActionSchema)
  if (!body.ok) return handleError(body.error)

  const result = await CrmDealRoomService.toggleAction(token, actionId, body.value)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
