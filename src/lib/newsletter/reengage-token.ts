import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { BETTER_AUTH_SECRET } from '@/lib/env/server'
import { err, ok, type Result } from '@/src/lib/result'

/**
 * Signed link of the re-engagement e-mail's "Quero continuar recebendo"
 * button (slice nl2-automation). Same format as the other newsletter links
 * (`<payloadBase64url>.<signatureBase64url>`, HMAC-SHA256 with
 * `BETTER_AUTH_SECRET`) under its own domain, so it never validates as a
 * confirmation, unsubscribe or preferences token. No expiry: pressing the
 * button late is still an explicit wish to keep receiving.
 */

const DOMAIN = 'crm-newsletter-reengage:v1'

export type ReengageTokenPayload = { reengagementId: string }

function sign(payloadB64: string): string {
  return createHmac('sha256', BETTER_AUTH_SECRET)
    .update(`${DOMAIN}:${payloadB64}`)
    .digest('base64url')
}

export function createReengageToken(reengagementId: string): string {
  const payloadB64 = Buffer.from(JSON.stringify({ reengagementId })).toString(
    'base64url',
  )
  return `${payloadB64}.${sign(payloadB64)}`
}

export function verifyReengageToken(
  token: string,
): Result<ReengageTokenPayload, 'invalid'> {
  const [payloadB64, signature, extra] = token.split('.')
  if (!payloadB64 || !signature || extra !== undefined) return err('invalid')
  const a = Buffer.from(signature)
  const b = Buffer.from(sign(payloadB64))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return err('invalid')
  try {
    const value = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as Partial<ReengageTokenPayload> | null
    const id = value?.reengagementId
    if (typeof id !== 'string' || id.length === 0) return err('invalid')
    return ok({ reengagementId: id })
  } catch {
    return err('invalid')
  }
}

/** Public page of the button (`/newsletter/continuar/<token>`). */
export function newsletterReengageUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/newsletter/continuar/${token}`
}
