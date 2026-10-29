import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { CrmNewsletterReengagementService } from '@/src/services/crm-newsletter-reengagement.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

/**
 * "Quero continuar recebendo" of the re-engagement e-mail (newsletter2,
 * nl2-automation). No session: the signed token is the authorization
 * (`/api/newsletters` is in PUBLIC_ROUTES). `GET` only reads (link
 * scanners); the page's button sends the `POST`.
 */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const limit = await consume(apiLimiter, `ip:${getClientIp(request)}`)
  if (!limit.ok) return handleError(limit.error)

  const { token } = await ctx.params
  const result = await CrmNewsletterReengagementService.reengagePreview(token)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const limit = await consume(apiLimiter, `ip:${getClientIp(request)}`)
  if (!limit.ok) return handleError(limit.error)

  const { token } = await ctx.params
  const result = await CrmNewsletterReengagementService.reengage(
    token,
    new Date(),
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
