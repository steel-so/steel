import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Signature of the outbound webhooks (ADR 0036, `docs/cli/README.md`):
 *
 *   Steel-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<body>">
 *
 * keyed by the endpoint secret (`whsec_...`, used as UTF-8 text). The
 * timestamp is `Steel-Webhook-Timestamp` (Unix seconds); receivers should
 * refuse it when it is more than 5 minutes off. Pure — no env, no I/O.
 */

export const WEBHOOK_SECRET_PREFIX = 'whsec_'
export const WEBHOOK_SIGNATURE_VERSION = 'v1'
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60

export const WEBHOOK_HEADERS = {
  id: 'Steel-Webhook-Id',
  timestamp: 'Steel-Webhook-Timestamp',
  signature: 'Steel-Signature',
} as const

/** `whsec_` + 32 random bytes (base64url). */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`
}

/** Last 4 characters, shown next to the endpoint so secrets can be told apart. */
export function webhookSecretHint(secret: string): string {
  return secret.slice(-4)
}

export function signWebhookPayload(
  secret: string,
  timestamp: number,
  body: string,
): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex')
  return `${WEBHOOK_SIGNATURE_VERSION}=${digest}`
}

/** The three headers of one attempt (the id is the event id). */
export function webhookRequestHeaders(input: {
  eventId: string
  secret: string
  body: string
  timestamp: number
}): Record<string, string> {
  return {
    [WEBHOOK_HEADERS.id]: input.eventId,
    [WEBHOOK_HEADERS.timestamp]: String(input.timestamp),
    [WEBHOOK_HEADERS.signature]: signWebhookPayload(
      input.secret,
      input.timestamp,
      input.body,
    ),
  }
}

/**
 * Receiver-side check (documented for integrators, used by the tests and by
 * `steel listen`): constant-time comparison of any `v1=` entry of the header
 * (several are allowed, comma-separated, during a secret rotation) and the
 * timestamp tolerance.
 */
export function verifyWebhookSignature(input: {
  secret: string
  body: string
  timestamp: string | number
  signature: string
  nowSeconds?: number
  toleranceSeconds?: number
}): boolean {
  const timestamp = Number(input.timestamp)
  if (!Number.isInteger(timestamp)) return false
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const tolerance = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS
  if (Math.abs(now - timestamp) > tolerance) return false

  const expected = Buffer.from(
    signWebhookPayload(input.secret, timestamp, input.body),
  )
  return input.signature
    .split(',')
    .map((part) => Buffer.from(part.trim()))
    .some(
      (candidate) =>
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected),
    )
}
