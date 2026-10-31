import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import {
  CreatePushSubscriptionSchema,
  DeletePushSubscriptionSchema,
} from '@/src/schemas/push-subscription.schema'
import { PushService } from '@/src/services/push.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/** Push status of the caller: configured?, VAPID public key, device count. */
export const GET = withAxiom(async () => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const result = await PushService.status(auth.value.user.id)
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})

/** Registers this device (the browser's `PushSubscription.toJSON()`). */
export const POST = withAxiom(async (request: NextRequest) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)

  const parsed = CreatePushSubscriptionSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await PushService.subscribe(
    auth.value.user.id,
    parsed.data,
    request.headers.get('user-agent'),
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})

/** Unregisters this device. */
export const DELETE = withAxiom(async (request: NextRequest) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)

  const parsed = DeletePushSubscriptionSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await PushService.unsubscribe(
    auth.value.user.id,
    parsed.data.endpoint,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
