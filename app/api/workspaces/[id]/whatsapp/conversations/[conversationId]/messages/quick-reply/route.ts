import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { SendWhatsAppQuickReplyMessageSchema } from '@/src/schemas/whatsapp-message.schema'
import { WhatsAppQuickReplyService } from '@/src/services/whatsapp-quick-reply.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; conversationId: string }> }

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const [{ id, conversationId }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const body = json.value
  const parsed = SendWhatsAppQuickReplyMessageSchema.safeParse(body)

  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await WhatsAppQuickReplyService.send(
    auth.value.user.id,
    id,
    conversationId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
