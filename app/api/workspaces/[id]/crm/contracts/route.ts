import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import {
  CreateCrmContractSchema,
  ListCrmContractsQuerySchema,
} from '@/src/schemas/crm-deals.schema'
import { CrmContractService } from '@/src/services/crm-contract.service'
import { authorizedUser, parseBody, parseQuery } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const user = await authorizedUser()
  if (!user.ok) return handleError(user.error)

  const query = parseQuery(request, ListCrmContractsQuerySchema)
  if (!query.ok) return handleError(query.error)

  const { id } = await ctx.params
  const result = await CrmContractService.list(user.value, id, query.value)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const user = await authorizedUser('POST /api/workspaces/[id]/crm/contracts')
  if (!user.ok) return handleError(user.error)

  const { id } = await ctx.params
  const body = await parseBody(request, CreateCrmContractSchema)
  if (!body.ok) return handleError(body.error)

  const result = await CrmContractService.create(user.value, id, body.value)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
