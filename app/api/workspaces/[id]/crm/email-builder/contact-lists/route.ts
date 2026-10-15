import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmEmailContactListsQuerySchema } from '@/src/schemas/crm-email-editor.schema'
import { CrmEmailConditionService } from '@/src/services/crm-email-condition.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Mailing lists of a CRM person, for the "Mostrar se" preview. */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const query = CrmEmailContactListsQuerySchema.safeParse({
    personId: new URL(request.url).searchParams.get('personId') ?? undefined,
  })
  if (!query.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      query.error.issues,
    )
  }

  const result = await CrmEmailConditionService.contactLists(
    auth.value.user.id,
    id,
    query.data.personId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
