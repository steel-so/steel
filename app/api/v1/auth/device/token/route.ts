import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, devicePollLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { DeviceTokenPollSchema } from '@/src/schemas/api-token.schema'
import { DeviceAuthorizationService } from '@/src/services/device-authorization.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/**
 * The CLI polls here with its device code: `428 AUTHORIZATION_PENDING`,
 * `429 SLOW_DOWN`, `410 EXPIRED_TOKEN`, `403 ACCESS_DENIED`, or `200` with
 * the personal token (returned once). Limited per IP.
 */
export const POST = withAxiom(async (request: NextRequest) => {
  const limit = await consume(devicePollLimiter, `ip:${getClientIp(request)}`)
  if (!limit.ok) return handleError(limit.error)

  const body = await request.json().catch(() => null)
  const parsed = DeviceTokenPollSchema.safeParse(body)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await DeviceAuthorizationService.poll(parsed.data.deviceCode)
  const response = result.ok
    ? successResponse(result.value)
    : handleError(result.error)
  response.headers.set('Cache-Control', 'no-store')
  return response
})
