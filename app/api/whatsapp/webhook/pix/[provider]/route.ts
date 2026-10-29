import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, whatsappWebhookLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { WhatsAppPixService } from '@/src/services/whatsapp-pix.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ provider: string }> }

/**
 * Pix payment notices from the PSP. Public: the provider authenticates the
 * call itself (HMAC signature over the raw body).
 */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const { provider } = await ctx.params
  const limit = await consume(
    whatsappWebhookLimiter,
    `pix:${getClientIp(request)}`,
  )
  if (!limit.ok) return handleError(limit.error)

  const rawBody = await request.text()
  const result = await WhatsAppPixService.handleWebhook(
    provider,
    request.headers,
    rawBody,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
