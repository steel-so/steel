import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { CreateOpportunityProposalSchema } from '@/src/schemas/crm-deals.schema'
import { DocumentCrmService } from '@/src/services/document-crm.service'
import { authorizedUser, parseBody } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; opportunityId: string }> }

/**
 * "Gerar proposta": a PROPOSAL document (ADR 0063) linked to the deal, its
 * company and point of contact, priced with the deal line items.
 */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const user = await authorizedUser(
    'POST /api/workspaces/[id]/crm/opportunities/[opportunityId]/proposal',
  )
  if (!user.ok) return handleError(user.error)

  const { id, opportunityId } = await ctx.params
  const body = await parseBody(request, CreateOpportunityProposalSchema)
  if (!body.ok) return handleError(body.error)

  const result = await DocumentCrmService.createForOpportunity(
    user.value,
    id,
    opportunityId,
    body.value,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
