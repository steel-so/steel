import { createHmac, timingSafeEqual } from 'node:crypto'

/** Header Steel documents for the signature of a store webhook. */
export const STORE_SIGNATURE_HEADER = 'x-steel-signature'
/** Header Nuvemshop signs its webhooks with (HMAC-SHA256, hex). */
export const NUVEMSHOP_SIGNATURE_HEADER = 'x-linkedstore-hmac-sha256'
/** Header a gateway or middleware may use to name the event. */
export const STORE_EVENT_HEADER = 'x-steel-event'

const SIGNATURE_HEADERS = [STORE_SIGNATURE_HEADER, NUVEMSHOP_SIGNATURE_HEADER]

/** Hex HMAC-SHA256 of the raw body, as the store must send it. */
export function signStorePayload(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

function matches(expected: string, received: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Whether one of the signature headers carries the HMAC of the raw body made
 * with the store's own secret. An optional `sha256=` prefix is accepted.
 */
export function verifyStoreSignature(
  headers: Headers,
  rawBody: string,
  secret: string,
): boolean {
  const expected = signStorePayload(secret, rawBody)
  return SIGNATURE_HEADERS.some((name) => {
    const value = headers.get(name)?.trim().toLowerCase()
    if (!value) return false
    return matches(expected, value.replace(/^sha256=/, ''))
  })
}
