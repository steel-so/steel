import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { BETTER_AUTH_SECRET } from '@/lib/env/server'
import { err, ok, type Result } from '@/src/lib/result'

/**
 * Signed vote link of a newsletter poll option (slice nl2-engage):
 * HMAC-SHA256 over the base64url JSON payload, with its own domain so it
 * never validates as any other newsletter or campaign token. It never
 * expires — an old e-mail still records (or changes) the vote.
 *
 * Payload (short keys keep the URL small): `r` = issue recipient (one
 * e-mail delivery), `b` = poll block id, `o` = option index.
 */

const DOMAIN = 'crm-newsletter-poll-vote:v1'

export type PollVoteTokenPayload = {
  recipientId: string
  blockId: string
  optionIndex: number
}

function sign(payloadB64: string): string {
  return createHmac('sha256', BETTER_AUTH_SECRET)
    .update(`${DOMAIN}:${payloadB64}`)
    .digest('base64url')
}

export function createPollVoteToken(payload: PollVoteTokenPayload): string {
  const payloadB64 = Buffer.from(
    JSON.stringify({
      r: payload.recipientId,
      b: payload.blockId,
      o: payload.optionIndex,
    }),
  ).toString('base64url')
  return `${payloadB64}.${sign(payloadB64)}`
}

export function verifyPollVoteToken(
  token: string,
): Result<PollVoteTokenPayload, 'invalid'> {
  const parts = token.split('.')
  if (parts.length !== 2) return err('invalid')
  const [payloadB64, signature] = parts
  if (!payloadB64 || !signature) return err('invalid')
  const a = Buffer.from(signature)
  const b = Buffer.from(sign(payloadB64))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return err('invalid')

  let value: { r?: unknown; b?: unknown; o?: unknown }
  try {
    value = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return err('invalid')
  }
  if (
    typeof value?.r !== 'string' ||
    !value.r ||
    typeof value.b !== 'string' ||
    !value.b ||
    typeof value.o !== 'number' ||
    !Number.isInteger(value.o) ||
    value.o < 0
  ) {
    return err('invalid')
  }
  return ok({ recipientId: value.r, blockId: value.b, optionIndex: value.o })
}
