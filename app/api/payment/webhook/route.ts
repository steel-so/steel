import type { NextRequest } from 'next/server'
import z from 'zod'
import { withAxiom } from '@/lib/axiom/server'
import { ABACATE_PAY_WEBHOOK_SECRET } from '@/lib/env/server'
import { verifyAbacatePayWebhook } from '@/src/lib/abacatepay-webhook'
import { isBillingEnabled } from '@/src/lib/billing'
import { SubscriptionService } from '@/src/services/subscription.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/**
 * v2 payloads carry the object under its kind (`data.subscription`,
 * `data.checkout`); a flat `data.id` is accepted too.
 */
const WebhookPayloadSchema = z
  .object({
    event: z.string(),
    data: z.object({
      id: z.string().optional(),
      subscription: z.object({ id: z.string() }).optional(),
      checkout: z.object({ id: z.string() }).optional(),
    }),
  })
  .refine(
    ({ data }) => Boolean(data.subscription?.id ?? data.checkout?.id ?? data.id),
    { message: 'data.id missing', path: ['data'] },
  )

export const POST = withAxiom(async (request: NextRequest) => {
  // Billing off: the endpoint does not exist. Nothing is read or processed,
  // and a 404 (not a 5xx) keeps the provider from retrying forever.
  if (!isBillingEnabled()) {
    return standardError('RESOURCE_NOT_FOUND', 'Not found')
  }

  // API v2: the secret rides in the URL (`?webhookSecret=`) and the body is
  // signed in `X-Webhook-Signature` (HMAC-SHA256, base64).
  const rawBody = await request.text()
  if (
    !verifyAbacatePayWebhook(
      ABACATE_PAY_WEBHOOK_SECRET,
      request.headers,
      rawBody,
      new URL(request.url).searchParams,
    )
  ) {
    return standardError('UNAUTHORIZED', 'Invalid webhook secret')
  }

  let body: unknown = null
  try {
    body = JSON.parse(rawBody)
  } catch {}
  const parsed = WebhookPayloadSchema.safeParse(body)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Payload inválido',
      parsed.error.issues,
    )
  }

  const { event, data } = parsed.data
  const billId = data.subscription?.id ?? data.checkout?.id ?? data.id ?? ''

  const result = await SubscriptionService.handleWebhookEvent(event, billId)
  if (!result.ok) return handleError(result.error)

  return successResponse({ received: true })
})
