import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { BETTER_AUTH_SECRET } from '@/lib/env/server'
import { err, ok, type Result } from '@/src/lib/result'
import { CRM_NEWSLETTER_CONFIRM_TTL_DAYS } from '@/src/schemas/crm-newsletter.schema'

/**
 * Signed, stateless links of the newsletter (ADR 0054). HMAC-SHA256 over
 * the base64url JSON payload with one domain per purpose, so a token for
 * one purpose never validates as another (nor as the campaign unsubscribe
 * token signed by the same secret).
 *
 * Format: `<payloadBase64url>.<signatureBase64url>`.
 *
 * - confirm: double opt-in, expires after CRM_NEWSLETTER_CONFIRM_TTL_DAYS.
 * - unsubscribe: one newsletter, never expires (old e-mails must keep
 *   working); carries the issue recipient for attribution when known.
 * - preferences: every newsletter of the workspace for one e-mail, never
 *   expires.
 */

type Purpose = 'confirm' | 'unsubscribe' | 'preferences'

const DOMAINS: Record<Purpose, string> = {
  confirm: 'crm-newsletter-confirm:v1',
  unsubscribe: 'crm-newsletter-unsubscribe:v1',
  preferences: 'crm-newsletter-preferences:v1',
}

export type ConfirmTokenPayload = { subscriberId: string; exp: number }
export type UnsubscribeTokenPayload = {
  subscriberId: string
  recipientId?: string
}
export type PreferencesTokenPayload = { workspaceId: string; email: string }

function sign(purpose: Purpose, payloadB64: string): string {
  return createHmac('sha256', BETTER_AUTH_SECRET)
    .update(`${DOMAINS[purpose]}:${payloadB64}`)
    .digest('base64url')
}

function create(purpose: Purpose, payload: object): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadB64}.${sign(purpose, payloadB64)}`
}

function read(purpose: Purpose, token: string): Result<unknown, 'invalid'> {
  const parts = token.split('.')
  if (parts.length !== 2) return err('invalid')
  const [payloadB64, signature] = parts
  if (!payloadB64 || !signature) return err('invalid')

  const a = Buffer.from(signature)
  const b = Buffer.from(sign(purpose, payloadB64))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return err('invalid')

  try {
    return ok(JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')))
  } catch {
    return err('invalid')
  }
}

const isNonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

export function createConfirmToken(subscriberId: string, now: Date): string {
  const exp =
    Math.floor(now.getTime() / 1000) +
    CRM_NEWSLETTER_CONFIRM_TTL_DAYS * 24 * 60 * 60
  return create('confirm', { subscriberId, exp })
}

export function verifyConfirmToken(
  token: string,
  now: Date,
): Result<ConfirmTokenPayload, 'invalid' | 'expired'> {
  const read_ = read('confirm', token)
  if (!read_.ok) return read_
  const value = (read_.value ?? {}) as Partial<ConfirmTokenPayload>
  if (!isNonEmpty(value.subscriberId) || typeof value.exp !== 'number') {
    return err('invalid')
  }
  if (value.exp * 1000 < now.getTime()) return err('expired')
  return ok({ subscriberId: value.subscriberId, exp: value.exp })
}

export function createUnsubscribeToken(
  payload: UnsubscribeTokenPayload,
): string {
  return create('unsubscribe', payload)
}

export function verifyUnsubscribeToken(
  token: string,
): Result<UnsubscribeTokenPayload, 'invalid'> {
  const read_ = read('unsubscribe', token)
  if (!read_.ok) return read_
  const value = (read_.value ?? {}) as Partial<UnsubscribeTokenPayload>
  if (!isNonEmpty(value.subscriberId)) return err('invalid')
  return ok({
    subscriberId: value.subscriberId,
    ...(isNonEmpty(value.recipientId) && { recipientId: value.recipientId }),
  })
}

export function createPreferencesToken(
  payload: PreferencesTokenPayload,
): string {
  return create('preferences', {
    workspaceId: payload.workspaceId,
    email: payload.email.toLowerCase(),
  })
}

export function verifyPreferencesToken(
  token: string,
): Result<PreferencesTokenPayload, 'invalid'> {
  const read_ = read('preferences', token)
  if (!read_.ok) return read_
  const value = (read_.value ?? {}) as Partial<PreferencesTokenPayload>
  if (!isNonEmpty(value.workspaceId) || !isNonEmpty(value.email)) {
    return err('invalid')
  }
  return ok({ workspaceId: value.workspaceId, email: value.email })
}

/**
 * Subscriber of a confirmation token whose signature is valid, ignoring the
 * expiry: lets the "link expired" page send a fresh confirmation. Never use
 * it to confirm.
 */
export function readConfirmTokenSubject(
  token: string,
): Result<{ subscriberId: string }, 'invalid'> {
  const read_ = read('confirm', token)
  if (!read_.ok) return read_
  const value = (read_.value ?? {}) as Partial<ConfirmTokenPayload>
  if (!isNonEmpty(value.subscriberId)) return err('invalid')
  return ok({ subscriberId: value.subscriberId })
}
