import { describe, expect, it } from 'vitest'
import {
  createConfirmToken,
  createPreferencesToken,
  createUnsubscribeToken,
  verifyConfirmToken,
  verifyPreferencesToken,
  verifyUnsubscribeToken,
} from '../newsletter/tokens'

const NOW = new Date('2026-10-28T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

describe('newsletter tokens', () => {
  it('round-trips a confirm token inside its 7-day window', () => {
    const token = createConfirmToken('sub_1', NOW)
    const verified = verifyConfirmToken(
      token,
      new Date(NOW.getTime() + 6 * DAY),
    )
    expect(verified.ok).toBe(true)
    if (verified.ok) expect(verified.value.subscriberId).toBe('sub_1')
  })

  it('expires a confirm token after 7 days', () => {
    const token = createConfirmToken('sub_1', NOW)
    const verified = verifyConfirmToken(
      token,
      new Date(NOW.getTime() + 8 * DAY),
    )
    expect(verified).toEqual({ ok: false, error: 'expired' })
  })

  it('round-trips an unsubscribe token with and without the recipient', () => {
    const withRecipient = verifyUnsubscribeToken(
      createUnsubscribeToken({ subscriberId: 'sub_1', recipientId: 'rcp_1' }),
    )
    expect(withRecipient).toEqual({
      ok: true,
      value: { subscriberId: 'sub_1', recipientId: 'rcp_1' },
    })
    const bare = verifyUnsubscribeToken(
      createUnsubscribeToken({ subscriberId: 'sub_1' }),
    )
    expect(bare).toEqual({ ok: true, value: { subscriberId: 'sub_1' } })
  })

  it('lower-cases the e-mail of a preferences token', () => {
    const verified = verifyPreferencesToken(
      createPreferencesToken({ workspaceId: 'ws_1', email: 'Ana@Acme.COM' }),
    )
    expect(verified).toEqual({
      ok: true,
      value: { workspaceId: 'ws_1', email: 'ana@acme.com' },
    })
  })

  it('does not accept a token of one purpose as another', () => {
    const unsubscribe = createUnsubscribeToken({ subscriberId: 'sub_1' })
    expect(verifyConfirmToken(unsubscribe, NOW).ok).toBe(false)
    expect(verifyPreferencesToken(unsubscribe).ok).toBe(false)
  })

  it('rejects a swapped payload', () => {
    const [, signature] = createUnsubscribeToken({ subscriberId: 'a' }).split(
      '.',
    )
    const payload = Buffer.from(JSON.stringify({ subscriberId: 'b' })).toString(
      'base64url',
    )
    expect(verifyUnsubscribeToken(`${payload}.${signature}`).ok).toBe(false)
  })

  it.each(['', 'abc', 'a.b.c', 'payload.'])('rejects malformed %j', (token) => {
    expect(verifyUnsubscribeToken(token).ok).toBe(false)
    expect(verifyPreferencesToken(token).ok).toBe(false)
    expect(verifyConfirmToken(token, NOW).ok).toBe(false)
  })
})
