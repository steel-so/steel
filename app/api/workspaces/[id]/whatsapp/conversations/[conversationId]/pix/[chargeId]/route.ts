import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WhatsAppPixService } from '@/src/services/whatsapp-pix.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; conversationId: string; chargeId: string }>
}

/** Cancels a charge that is still waiting for payment. */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, conversationId, chargeId } = await ctx.params
  const result = await WhatsAppPixService.cancel(
    auth.value.user.id,
    id,
    conversationId,
    chargeId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
