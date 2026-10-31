import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, whatsappWebhookLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { BoletoWebhookService } from '@/src/services/boleto-webhook.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ provider: string }> }

/**
 * Boleto notices from the PSP (paid, refunded, expired). Public: the provider
 * authenticates the call itself (secret in the URL + body signature).
 */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const { provider } = await ctx.params
  const limit = await consume(
    whatsappWebhookLimiter,
    `boleto:${getClientIp(request)}`,
  )
  if (!limit.ok) return handleError(limit.error)

  const result = await BoletoWebhookService.handle(
    provider,
    request.headers,
    await request.text(),
    request.nextUrl.searchParams,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
