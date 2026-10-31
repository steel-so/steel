import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, whatsappWebhookLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { CrmProposalPaymentService } from '@/src/services/crm-proposal-payment.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ provider: string }> }

/**
 * Payment notices of the proposal charges. Public: the provider authenticates
 * the call itself (HMAC signature over the raw body).
 */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const { provider } = await ctx.params
  const limit = await consume(
    whatsappWebhookLimiter,
    `crm-pay:${getClientIp(request)}`,
  )
  if (!limit.ok) return handleError(limit.error)

  const rawBody = await request.text()
  const result = await CrmProposalPaymentService.handleWebhook(
    provider,
    request.headers,
    rawBody,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
