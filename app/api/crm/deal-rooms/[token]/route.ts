import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { CrmDealRoomService } from '@/src/services/crm-deal-room.service'
import { publicIp } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

/** The room as the customer sees it (the token is the access). */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = await publicIp(request, 'deal-room')
  if (!ip.ok) return handleError(ip.error)

  const { token } = await ctx.params
  const result = await CrmDealRoomService.getPublic(token)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
