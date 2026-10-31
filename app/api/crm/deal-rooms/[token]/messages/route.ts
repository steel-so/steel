import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { PostDealRoomMessageSchema } from '@/src/schemas/crm-deals.schema'
import { CrmDealRoomService } from '@/src/services/crm-deal-room.service'
import { parseBody, publicIp } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

/** The customer writes in the room chat. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = await publicIp(request, 'deal-room-message')
  if (!ip.ok) return handleError(ip.error)

  const { token } = await ctx.params
  const body = await parseBody(request, PostDealRoomMessageSchema)
  if (!body.ok) return handleError(body.error)

  const result = await CrmDealRoomService.postPublicMessage(token, body.value)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
