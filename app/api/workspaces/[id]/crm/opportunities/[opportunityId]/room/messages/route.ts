import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import {
  CreateDealRoomMessageSchema,
  ListDealRoomMessagesQuerySchema,
} from '@/src/schemas/crm-deals.schema'
import { CrmDealRoomService } from '@/src/services/crm-deal-room.service'
import { authorizedUser, parseBody, parseQuery } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; opportunityId: string }> }

export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const user = await authorizedUser()
  if (!user.ok) return handleError(user.error)

  const query = parseQuery(request, ListDealRoomMessagesQuerySchema)
  if (!query.ok) return handleError(query.error)

  const { id, opportunityId } = await ctx.params
  const result = await CrmDealRoomService.listMessages(
    user.value,
    id,
    opportunityId,
    query.value.limit,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const user = await authorizedUser(
    'POST /api/workspaces/[id]/crm/opportunities/[opportunityId]/room/messages',
  )
  if (!user.ok) return handleError(user.error)

  const { id, opportunityId } = await ctx.params
  const body = await parseBody(request, CreateDealRoomMessageSchema)
  if (!body.ok) return handleError(body.error)

  const result = await CrmDealRoomService.postMessage(
    user.value,
    id,
    opportunityId,
    body.value,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
