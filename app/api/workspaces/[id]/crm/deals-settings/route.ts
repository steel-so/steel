import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { UpdateCrmDealsSettingsSchema } from '@/src/schemas/crm-deals.schema'
import { CrmDealsSettingsService } from '@/src/services/crm-deals-settings.service'
import { authorizedUser, parseBody } from '@/utils/crm-deals-route'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const user = await authorizedUser()
  if (!user.ok) return handleError(user.error)

  const { id } = await ctx.params
  const result = await CrmDealsSettingsService.get(user.value, id)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const user = await authorizedUser('PATCH /api/workspaces/[id]/crm/deals-settings')
  if (!user.ok) return handleError(user.error)

  const { id } = await ctx.params
  const body = await parseBody(request, UpdateCrmDealsSettingsSchema)
  if (!body.ok) return handleError(body.error)

  const result = await CrmDealsSettingsService.update(user.value, id, body.value)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
