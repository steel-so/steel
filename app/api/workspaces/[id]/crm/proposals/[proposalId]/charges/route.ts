import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { CreateCrmProposalChargeSchema } from '@/src/schemas/crm-deals.schema'
import { CrmProposalPaymentService } from '@/src/services/crm-proposal-payment.service'
import { authorizedUser, parseBody } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; proposalId: string }> }

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const user = await authorizedUser(
    'POST /api/workspaces/[id]/crm/proposals/[proposalId]/charges',
  )
  if (!user.ok) return handleError(user.error)

  const { id, proposalId } = await ctx.params
  const body = await parseBody(request, CreateCrmProposalChargeSchema)
  if (!body.ok) return handleError(body.error)

  const result = await CrmProposalPaymentService.createCharge(
    user.value,
    id,
    proposalId,
    body.value,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
