import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmNewsletterAiService } from '@/src/services/crm-newsletter-ai.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; newsletterId: string }> }

/** Sources the "Escrever com IA" dialog offers (titles only). */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, newsletterId } = await ctx.params
  const result = await CrmNewsletterAiService.sources(
    auth.value.user.id,
    id,
    newsletterId,
    new Date(),
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
