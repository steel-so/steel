import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { ApiTokenIdSchema } from '@/src/schemas/api-token.schema'
import { ApiTokenService } from '@/src/services/api-token.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Revokes one of the user's tokens; its next `/api/v1` call answers 401. */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const parsed = ApiTokenIdSchema.safeParse(id)
  if (!parsed.success) {
    return standardError('VALIDATION_ERROR', 'Id inválido', parsed.error.issues)
  }

  const result = await ApiTokenService.revokeForUser(
    auth.value.user.id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
