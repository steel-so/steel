import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  generateWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_HEADERS,
  webhookRequestHeaders,
  webhookSecretHint,
} from '@/src/lib/webhooks/signature'

const SECRET = 'whsec_test_secret'
const BODY = '{"id":"evt_1","type":"steel.ping"}'
const TS = 1_760_788_800

describe('webhook signature', () => {
  it('should be v1= + hex HMAC-SHA256 of "<timestamp>.<body>"', () => {
    const expected = createHmac('sha256', SECRET)
      .update(`${TS}.${BODY}`)
      .digest('hex')
    expect(signWebhookPayload(SECRET, TS, BODY)).toBe(`v1=${expected}`)
  })

  it('should build the three Steel-Webhook headers', () => {
    const headers = webhookRequestHeaders({
      eventId: 'evt_1',
      secret: SECRET,
      body: BODY,
      timestamp: TS,
    })
    expect(headers).toEqual({
      [WEBHOOK_HEADERS.id]: 'evt_1',
      [WEBHOOK_HEADERS.timestamp]: String(TS),
      [WEBHOOK_HEADERS.signature]: signWebhookPayload(SECRET, TS, BODY),
    })
  })

  it('should verify a valid signature inside the tolerance', () => {
    const signature = signWebhookPayload(SECRET, TS, BODY)
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: BODY,
        timestamp: String(TS),
        signature,
        nowSeconds: TS + 60,
      }),
    ).toBe(true)
  })

  it('should accept any of several signatures (secret rotation)', () => {
    const signature = `v1=deadbeef, ${signWebhookPayload(SECRET, TS, BODY)}`
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: BODY,
        timestamp: TS,
        signature,
        nowSeconds: TS,
      }),
    ).toBe(true)
  })

  it('should refuse a tampered body, a wrong secret, an old timestamp or garbage', () => {
    const signature = signWebhookPayload(SECRET, TS, BODY)
    const base = {
      secret: SECRET,
      body: BODY,
      timestamp: TS,
      signature,
      nowSeconds: TS,
    }
    expect(verifyWebhookSignature({ ...base, body: `${BODY} ` })).toBe(false)
    expect(verifyWebhookSignature({ ...base, secret: 'whsec_other' })).toBe(
      false,
    )
    expect(verifyWebhookSignature({ ...base, nowSeconds: TS + 301 })).toBe(
      false,
    )
    expect(verifyWebhookSignature({ ...base, timestamp: 'abc' })).toBe(false)
    expect(verifyWebhookSignature({ ...base, signature: 'v1=short' })).toBe(
      false,
    )
  })

  it('should use the current clock by default', () => {
    const now = Math.floor(Date.now() / 1000)
    const signature = signWebhookPayload(SECRET, now, BODY)
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: BODY,
        timestamp: now,
        signature,
      }),
    ).toBe(true)
  })

  it('should generate distinct whsec_ secrets and a 4-char hint', () => {
    const a = generateWebhookSecret()
    const b = generateWebhookSecret()
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
    expect(webhookSecretHint(a)).toBe(a.slice(-4))
  })
})
