import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WhatsAppCostService } from '@/src/services/whatsapp-cost.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; priceId: string }> }

export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, priceId } = await ctx.params
  const result = await WhatsAppCostService.deletePrice(
    auth.value.user.id,
    id,
    priceId,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse({ id: priceId })
})
