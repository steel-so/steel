import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CustomerLinkStateQuerySchema } from '@/src/schemas/customer-link.schema'
import { CustomerLinkService } from '@/src/services/customer-link.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Current link of a record plus the CRM candidates to link it to. */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const { searchParams } = new URL(request.url)
  const parsed = CustomerLinkStateQuerySchema.safeParse({
    kind: searchParams.get('kind') ?? undefined,
    id: searchParams.get('id') ?? undefined,
  })
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      parsed.error.issues,
    )
  }

  const result = await CustomerLinkService.getState(
    auth.value.user.id,
    id,
    parsed.data.kind,
    parsed.data.id,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
