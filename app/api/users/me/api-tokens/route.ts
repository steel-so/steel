import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CreateApiTokenSchema } from '@/src/schemas/api-token.schema'
import { ApiTokenService } from '@/src/services/api-token.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/** "Tokens de API" of the signed-in user (ADR 0035); never the values. */
export const GET = withAxiom(async () => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const result = await ApiTokenService.listForUser(auth.value.user.id)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Creates a personal token; the value comes back only in this answer. */
export const POST = withAxiom(async (request: NextRequest) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const body = await request.json().catch(() => null)
  const parsed = CreateApiTokenSchema.safeParse(body)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await ApiTokenService.createForUser(
    auth.value.user.id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  const response = successResponse(result.value, 201)
  response.headers.set('Cache-Control', 'no-store')
  return response
})
