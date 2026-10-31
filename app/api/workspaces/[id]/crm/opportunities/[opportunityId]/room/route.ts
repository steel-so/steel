import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { UpsertCrmDealRoomSchema } from '@/src/schemas/crm-deals.schema'
import { CrmDealRoomService } from '@/src/services/crm-deal-room.service'
import { authorizedUser, parseBody } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; opportunityId: string }> }

/** The deal room, or `null` when the deal has none yet. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const user = await authorizedUser()
  if (!user.ok) return handleError(user.error)

  const { id, opportunityId } = await ctx.params
  const result = await CrmDealRoomService.get(user.value, id, opportunityId)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Creates the room on first use, then edits it. */
export const PUT = withAxiom(async (request: NextRequest, ctx: Params) => {
  const user = await authorizedUser(
    'PUT /api/workspaces/[id]/crm/opportunities/[opportunityId]/room',
  )
  if (!user.ok) return handleError(user.error)

  const { id, opportunityId } = await ctx.params
  const body = await parseBody(request, UpsertCrmDealRoomSchema)
  if (!body.ok) return handleError(body.error)

  const result = await CrmDealRoomService.upsert(
    user.value,
    id,
    opportunityId,
    body.value,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
