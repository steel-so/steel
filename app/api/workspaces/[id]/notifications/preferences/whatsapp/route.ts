import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { UpdateNotificationWhatsappSchema } from '@/src/schemas/notification-preference.schema'
import { NotificationWhatsappService } from '@/src/services/notification-whatsapp.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

async function session() {
  const auth = await getAuthSession()
  if (!auth.ok) return auth
  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return limit
  return auth
}

/** WhatsApp channel of the caller's notices (number is always masked). */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await session()
  if (!auth.ok) return handleError(auth.error)
  const { id } = await ctx.params
  const result = await NotificationWhatsappService.status(
    auth.value.user.id,
    id,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})

/** Switches the verified channel on or off. */
export const PUT = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await session()
  if (!auth.ok) return handleError(auth.error)
  const [{ id }, json] = await Promise.all([ctx.params, readJsonBody(request)])
  if (!json.ok) return handleError(json.error)
  const parsed = UpdateNotificationWhatsappSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }
  const result = await NotificationWhatsappService.setEnabled(
    auth.value.user.id,
    id,
    parsed.data.enabled,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})

/** Forgets the number. */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await session()
  if (!auth.ok) return handleError(auth.error)
  const { id } = await ctx.params
  const result = await NotificationWhatsappService.remove(
    auth.value.user.id,
    id,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
