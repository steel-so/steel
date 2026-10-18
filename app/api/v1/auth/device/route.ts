import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { consume, deviceStartLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { DeviceAuthorizationStartSchema } from '@/src/schemas/api-token.schema'
import { DeviceAuthorizationService } from '@/src/services/device-authorization.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/**
 * Starts a `steel login` (device flow, ADR 0035): a device code for the CLI
 * to poll with and a user code to confirm on `/device`. No session or token;
 * limited per IP.
 */
export const POST = withAxiom(async (request: NextRequest) => {
  const limit = await consume(deviceStartLimiter, `ip:${getClientIp(request)}`)
  if (!limit.ok) return handleError(limit.error)

  const raw = await request.text()
  let body: unknown = {}
  if (raw.trim()) {
    try {
      body = JSON.parse(raw)
    } catch {
      return standardError('VALIDATION_ERROR', 'JSON inválido')
    }
  }
  const parsed = DeviceAuthorizationStartSchema.safeParse(body)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await DeviceAuthorizationService.start(
    parsed.data,
    BETTER_AUTH_URL,
  )
  if (!result.ok) return handleError(result.error)

  const response = successResponse(result.value)
  response.headers.set('Cache-Control', 'no-store')
  return response
})
