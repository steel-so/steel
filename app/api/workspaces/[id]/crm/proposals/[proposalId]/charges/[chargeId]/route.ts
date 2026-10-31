import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { CrmProposalPaymentService } from '@/src/services/crm-proposal-payment.service'
import { authorizedUser } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; proposalId: string; chargeId: string }>
}

/** Cancels a charge that is still waiting for payment. */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const user = await authorizedUser(
    'DELETE /api/workspaces/[id]/crm/proposals/[proposalId]/charges/[chargeId]',
  )
  if (!user.ok) return handleError(user.error)

  const { id, proposalId, chargeId } = await ctx.params
  const result = await CrmProposalPaymentService.cancelCharge(
    user.value,
    id,
    proposalId,
    chargeId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
