import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WhatsAppContactBlockService } from '@/src/services/whatsapp-contact-block.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; conversationId: string }> }

/** Is the conversation's contact blocked on its number? (inbox banner) */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, conversationId } = await ctx.params
  const result = await WhatsAppContactBlockService.conversationState(
    auth.value.user.id,
    id,
    conversationId,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
