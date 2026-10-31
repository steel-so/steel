import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { UpdateCrmContractSchema } from '@/src/schemas/crm-deals.schema'
import { CrmContractService } from '@/src/services/crm-contract.service'
import { authorizedUser, parseBody } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; contractId: string }> }

export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const user = await authorizedUser()
  if (!user.ok) return handleError(user.error)

  const { id, contractId } = await ctx.params
  const result = await CrmContractService.get(user.value, id, contractId)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const user = await authorizedUser(
    'PATCH /api/workspaces/[id]/crm/contracts/[contractId]',
  )
  if (!user.ok) return handleError(user.error)

  const { id, contractId } = await ctx.params
  const body = await parseBody(request, UpdateCrmContractSchema)
  if (!body.ok) return handleError(body.error)

  const result = await CrmContractService.update(
    user.value,
    id,
    contractId,
    body.value,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const user = await authorizedUser(
    'DELETE /api/workspaces/[id]/crm/contracts/[contractId]',
  )
  if (!user.ok) return handleError(user.error)

  const { id, contractId } = await ctx.params
  const result = await CrmContractService.remove(user.value, id, contractId)
  if (!result.ok) return handleError(result.error)

  return successResponse({ deleted: true })
})
