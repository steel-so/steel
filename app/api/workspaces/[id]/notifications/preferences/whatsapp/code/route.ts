import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { RequestNotificationWhatsappCodeSchema } from '@/src/schemas/notification-preference.schema'
import { NotificationWhatsappService } from '@/src/services/notification-whatsapp.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Sends the 6-digit code to the number through the workspace line. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)
  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const [{ id }, json] = await Promise.all([ctx.params, readJsonBody(request)])
  if (!json.ok) return handleError(json.error)
  const parsed = RequestNotificationWhatsappCodeSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }
  const result = await NotificationWhatsappService.requestCode(
    auth.value.user.id,
    id,
    parsed.data.number,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
