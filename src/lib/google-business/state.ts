import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { BETTER_AUTH_SECRET } from '@/lib/env/server'
import { err, ok, type Result } from '@/src/lib/result'

/**
 * OAuth `state` of the Google Business connection: stateless, signed with
 * HMAC-SHA256 (`BETTER_AUTH_SECRET`), short-lived and bound to the user that
 * started the flow, so a callback replayed by someone else is rejected.
 * Format: `<payloadBase64url>.<signatureBase64url>`.
 */

const STATE_TTL_MS = 10 * 60 * 1000

export type GoogleBusinessState = {
  purpose: 'google-business'
  workspaceId: string
  slug: string
  userId: string
  nonce: string
  exp: number
}

function sign(payloadB64: string): string {
  return createHmac('sha256', BETTER_AUTH_SECRET)
    .update(payloadB64)
    .digest('base64url')
}

export function createGoogleBusinessState(input: {
  workspaceId: string
  slug: string
  userId: string
}): string {
  const payload: GoogleBusinessState = {
    purpose: 'google-business',
    ...input,
    nonce: randomBytes(16).toString('base64url'),
    exp: Date.now() + STATE_TTL_MS,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadB64}.${sign(payloadB64)}`
}

export function verifyGoogleBusinessState(
  state: string,
): Result<GoogleBusinessState, 'invalid'> {
  const [payloadB64, signature] = state.split('.')
  if (!payloadB64 || !signature) return err('invalid')

  const a = Buffer.from(signature)
  const b = Buffer.from(sign(payloadB64))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return err('invalid')

  let payload: GoogleBusinessState
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return err('invalid')
  }
  if (
    payload.purpose !== 'google-business' ||
    typeof payload.exp !== 'number' ||
    payload.exp < Date.now() ||
    typeof payload.workspaceId !== 'string' ||
    !payload.workspaceId ||
    typeof payload.userId !== 'string' ||
    !payload.userId
  ) {
    return err('invalid')
  }
  return ok(payload)
}
