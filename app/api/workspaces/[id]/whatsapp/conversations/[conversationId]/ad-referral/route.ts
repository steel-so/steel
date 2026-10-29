import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WhatsAppAdAttributionService } from '@/src/services/whatsapp-ad-attribution.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; conversationId: string }> }

/** The ad that opened the conversation, or `null` for an ordinary one. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, conversationId } = await ctx.params
  const result = await WhatsAppAdAttributionService.getConversationReferral(
    auth.value.user.id,
    id,
    conversationId,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
