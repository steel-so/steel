import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { PhoneCallService } from '@/src/services/phone-call.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; personId: string }> }

/** Calls attached to the person (matched by phone). */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const { id, personId } = await ctx.params
  const result = await PhoneCallService.listForCrmPerson(
    auth.value.user.id,
    id,
    personId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
