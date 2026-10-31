import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WhatsAppCommerceService } from '@/src/services/whatsapp-commerce.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const params = request.nextUrl.searchParams
  const available = params.get('available')
  const result = await WhatsAppCommerceService.listProducts(
    auth.value.user.id,
    id,
    {
      available: available === null ? undefined : available === 'true',
      search: params.get('search')?.slice(0, 100) || undefined,
    },
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
