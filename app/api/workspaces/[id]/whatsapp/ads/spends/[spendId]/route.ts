import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WhatsAppAdAttributionService } from '@/src/services/whatsapp-ad-attribution.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; spendId: string }> }

export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, spendId } = await ctx.params
  const result = await WhatsAppAdAttributionService.deleteSpend(
    auth.value.user.id,
    id,
    spendId,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse({ id: spendId })
})
