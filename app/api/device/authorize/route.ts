import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { consume, deviceVerifyLimiter } from '@/src/lib/rate-limit'
import { DeviceAuthorizeSchema } from '@/src/schemas/api-token.schema'
import { DeviceAuthorizationService } from '@/src/services/device-authorization.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/**
 * Answer of the `/device` page (session): approve a `steel login` for a
 * workspace, modules, access level and validity, or refuse it. Limited per
 * user, against guessing codes.
 */
export const POST = withAxiom(async (request: NextRequest) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(deviceVerifyLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const body = await request.json().catch(() => null)
  const parsed = DeviceAuthorizeSchema.safeParse(body)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await DeviceAuthorizationService.decide(
    auth.value.user.id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
