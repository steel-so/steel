import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { RecordDealRoomEventSchema } from '@/src/schemas/crm-deals.schema'
import { CrmDealRoomService } from '@/src/services/crm-deal-room.service'
import { parseBody, publicIp } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

/** Logs what the visitor opened (proposal, material). */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = await publicIp(request, 'deal-room-event')
  if (!ip.ok) return handleError(ip.error)

  const { token } = await ctx.params
  const body = await parseBody(request, RecordDealRoomEventSchema)
  if (!body.ok) return handleError(body.error)

  const result = await CrmDealRoomService.recordEvent(token, body.value)
  if (!result.ok) return handleError(result.error)

  return successResponse({ recorded: true }, 201)
})
