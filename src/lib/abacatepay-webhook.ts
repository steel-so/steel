import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const ABACATEPAY_SIGNATURE_HEADER = 'x-webhook-signature'
export const ABACATEPAY_SECRET_PARAM = 'webhookSecret'

/**
 * Public key AbacatePay publishes to sign every webhook body
 * (https://docs.abacatepay.com/pages/webhooks). It is not a secret: it only
 * proves the body was not changed. The origin is proven by the
 * `webhookSecret` query param of the URL registered at AbacatePay.
 */
export const ABACATEPAY_WEBHOOK_PUBLIC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9'

/** Base64 HMAC-SHA256 of the raw body, as AbacatePay signs it. */
export function signAbacatePayBody(rawBody: string): string {
  return createHmac('sha256', ABACATEPAY_WEBHOOK_PUBLIC_KEY)
    .update(Buffer.from(rawBody, 'utf8'))
    .digest('base64')
}

function safeEqual(expected: string, received: string | null): boolean {
  if (!received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Origin (secret in the URL) and integrity (body signature) checks only; the
 * body is not parsed. Shared by billing, Pix and boleto webhooks.
 */
export function verifyAbacatePayWebhook(
  secret: string | undefined,
  headers: Headers,
  rawBody: string,
  query?: URLSearchParams,
): boolean {
  if (!secret) return false
  if (!safeEqual(secret, query?.get(ABACATEPAY_SECRET_PARAM) ?? null)) {
    return false
  }
  return safeEqual(
    signAbacatePayBody(rawBody),
    headers.get(ABACATEPAY_SIGNATURE_HEADER),
  )
}

const ChargeSchema = z.object({
  id: z.string().min(1).optional(),
  amount: z.number().optional(),
  paidAmount: z.number().optional(),
  updatedAt: z.string().optional(),
})

const EnvelopeSchema = z.object({
  event: z.string(),
  data: z
    .object({
      transparent: ChargeSchema.optional(),
      checkout: ChargeSchema.optional(),
      payerInformation: z
        .object({ PIX: z.object({ name: z.string().nullish() }).nullish() })
        .nullish(),
    })
    .extend(ChargeSchema.shape),
})

export interface AbacatePayWebhookEvent {
  event: string
  chargeId: string | null
  /** Cents; the paid amount when present, else the charge amount. */
  cents: number | null
  at: Date
  payerName: string | null
}

/**
 * Authenticates a webhook call (secret in the URL + body signature) and
 * parses the envelope. Returns null when anything fails; the caller maps it
 * to its own "invalid webhook" error.
 */
export function readAbacatePayWebhook(
  secret: string | undefined,
  headers: Headers,
  rawBody: string,
  query?: URLSearchParams,
): AbacatePayWebhookEvent | null {
  if (!verifyAbacatePayWebhook(secret, headers, rawBody, query)) return null
  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return null
  }
  const parsed = EnvelopeSchema.safeParse(json)
  if (!parsed.success) return null

  const { data } = parsed.data
  const charge = data.transparent ?? data.checkout ?? data
  const updated = charge.updatedAt ? new Date(charge.updatedAt) : new Date()
  return {
    event: parsed.data.event,
    chargeId: charge.id ?? null,
    cents: charge.paidAmount ?? charge.amount ?? null,
    at: Number.isNaN(updated.getTime()) ? new Date() : updated,
    payerName: data.payerInformation?.PIX?.name ?? null,
  }
}
