import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { CrmProposalPaymentService } from '@/src/services/crm-proposal-payment.service'
import { publicIp } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ shareToken: string }> }

/** Signature and payment state of a shared proposal (the token is the access). */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = await publicIp(request, 'proposal-checkout')
  if (!ip.ok) return handleError(ip.error)

  const { shareToken } = await ctx.params
  const result = await CrmProposalPaymentService.getPublicCheckout(shareToken)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
