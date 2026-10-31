import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { IdentifyDealRoomVisitorSchema } from '@/src/schemas/crm-deals.schema'
import { CrmDealRoomService } from '@/src/services/crm-deal-room.service'
import { parseBody, publicIp } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

/** First contact: the visitor gives a name and e-mail; the opening is logged. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = await publicIp(request, 'deal-room-visitor')
  if (!ip.ok) return handleError(ip.error)

  const { token } = await ctx.params
  const body = await parseBody(request, IdentifyDealRoomVisitorSchema)
  if (!body.ok) return handleError(body.error)

  const result = await CrmDealRoomService.identify(token, ip.value, body.value)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
