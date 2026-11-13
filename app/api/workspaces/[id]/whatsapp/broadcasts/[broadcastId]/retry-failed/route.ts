import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { RetryFailedWhatsAppBroadcastSchema } from '@/src/schemas/whatsapp-broadcast.schema'
import { WhatsAppBroadcastService } from '@/src/services/whatsapp-broadcast.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; broadcastId: string }> }

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, broadcastId } = await ctx.params

  // The body is optional: without it every failed recipient is retried.
  const json = await readJsonBody(request, { allowEmpty: true })
  if (!json.ok) return handleError(json.error)
  const parsed = RetryFailedWhatsAppBroadcastSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await WhatsAppBroadcastService.retryFailed(
    auth.value.user.id,
    id,
    broadcastId,
    parsed.data.recipientIds,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
