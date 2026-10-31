import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { SignCrmProposalSchema } from '@/src/schemas/crm-deals.schema'
import { CrmProposalPaymentService } from '@/src/services/crm-proposal-payment.service'
import { parseBody, publicIp } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ shareToken: string }> }

/** The customer signs (and so accepts) the proposal with a drawn signature. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = await publicIp(request, 'proposal-sign')
  if (!ip.ok) return handleError(ip.error)

  const { shareToken } = await ctx.params
  const body = await parseBody(request, SignCrmProposalSchema)
  if (!body.ok) return handleError(body.error)

  const result = await CrmProposalPaymentService.sign(
    shareToken,
    ip.value,
    body.value,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
