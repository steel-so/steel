import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { CrmProposalPaymentService } from '@/src/services/crm-proposal-payment.service'
import { authorizedUser } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; proposalId: string }> }

/** Charges and signatures of a proposal (the seller's screen). */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const user = await authorizedUser()
  if (!user.ok) return handleError(user.error)

  const { id, proposalId } = await ctx.params
  const result = await CrmProposalPaymentService.checkout(
    user.value,
    id,
    proposalId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
