import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { CrmContractService } from '@/src/services/crm-contract.service'
import { authorizedUser } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** OWNER/ADMIN: runs the renewal scan of the workspace now. */
export const POST = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const user = await authorizedUser(
    'POST /api/workspaces/[id]/crm/contracts/scan',
  )
  if (!user.ok) return handleError(user.error)

  const { id } = await ctx.params
  const result = await CrmContractService.scan(user.value, id)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
