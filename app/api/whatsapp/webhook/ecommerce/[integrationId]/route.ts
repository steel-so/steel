import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, whatsappWebhookLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { WhatsAppStoreService } from '@/src/services/whatsapp-store.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ integrationId: string }> }

/** Largest webhook body read: store events are small objects. */
const MAX_BODY_BYTES = 256 * 1024

/**
 * Store webhooks (Tray, Nuvemshop, VTEX). Public: each call authenticates
 * itself with the HMAC-SHA256 of the raw body made with the store's own
 * secret (`x-steel-signature`, or Nuvemshop's `x-linkedstore-hmac-sha256`).
 */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const { integrationId } = await ctx.params
  const limit = await consume(
    whatsappWebhookLimiter,
    `ecom:${getClientIp(request)}`,
  )
  if (!limit.ok) return handleError(limit.error)

  const rawBody = await request.text()
  if (rawBody.length > MAX_BODY_BYTES) {
    return new Response('Payload too large', { status: 413 })
  }
  const result = await WhatsAppStoreService.receiveWebhook(
    integrationId,
    request.headers,
    rawBody,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
