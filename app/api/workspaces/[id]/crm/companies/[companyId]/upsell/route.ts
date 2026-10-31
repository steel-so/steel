import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { CrmContractService } from '@/src/services/crm-contract.service'
import { authorizedUser } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; companyId: string }> }

/** Expansion ideas for a customer, framed by its survey and health. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const user = await authorizedUser()
  if (!user.ok) return handleError(user.error)

  const { id, companyId } = await ctx.params
  const result = await CrmContractService.upsell(user.value, id, companyId)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
