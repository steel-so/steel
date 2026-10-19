import 'server-only'
import { createHash, createHmac } from 'node:crypto'
import { BETTER_AUTH_SECRET, BETTER_AUTH_URL } from '@/lib/env/server'

/**
 * Webhook plumbing of the Apollo phone reveal. Apollo only delivers phones
 * (asynchronously, minutes later) to an HTTPS `webhook_url`, so every import
 * gets its own secret path segment. The token is derived (HMAC of the import
 * id), which lets the worker rebuild the URL on any resume without storing
 * the secret; the database keeps only its SHA-256 for the lookup.
 */

export const APOLLO_WEBHOOK_PATH = '/api/crm/apollo/webhook'
/** Credits Apollo charges per returned mobile number (docs: +8). */
export const APOLLO_PHONE_CREDITS = 8
/** How long after an import finished its webhook still answers. */
export const APOLLO_WEBHOOK_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function apolloWebhookToken(importId: string): string {
  return createHmac('sha256', BETTER_AUTH_SECRET)
    .update(`apollo-phone-webhook:${importId}`)
    .digest('base64url')
}

export function hashApolloWebhookToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Apollo refuses non-HTTPS callbacks, so the option is off without it. */
export function isApolloPhoneRevealAvailable(
  baseUrl: string = BETTER_AUTH_URL,
): boolean {
  return baseUrl.startsWith('https://')
}

export function buildApolloWebhookUrl(
  token: string,
  baseUrl: string = BETTER_AUTH_URL,
): string {
  return `${baseUrl.replace(/\/+$/, '')}${APOLLO_WEBHOOK_PATH}/${token}`
}
