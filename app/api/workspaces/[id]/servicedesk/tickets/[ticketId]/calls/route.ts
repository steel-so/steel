import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { PhoneCallService } from '@/src/services/phone-call.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; ticketId: string }> }

/** Calls attached to the ticket (agents only). `ticketId` = id or code. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const { id, ticketId } = await ctx.params
  const result = await PhoneCallService.listForTicket(
    auth.value.user.id,
    id,
    ticketId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
