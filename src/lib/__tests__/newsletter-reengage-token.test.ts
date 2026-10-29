import { describe, expect, it } from 'vitest'
import {
  createReengageToken,
  newsletterReengageUrl,
  verifyReengageToken,
} from '../newsletter/reengage-token'
import { createUnsubscribeToken } from '../newsletter/tokens'

describe('newsletter re-engagement token', () => {
  it('round-trips the attempt id', () => {
    const verified = verifyReengageToken(createReengageToken('re_1'))
    expect(verified).toEqual({ ok: true, value: { reengagementId: 're_1' } })
  })

  it('rejects tampered, malformed and other-purpose tokens', () => {
    const token = createReengageToken('re_1')
    const [payload, signature] = token.split('.')
    const forged = `${Buffer.from(JSON.stringify({ reengagementId: 're_2' })).toString('base64url')}.${signature}`
    const empty = Buffer.from(JSON.stringify({ reengagementId: '' })).toString(
      'base64url',
    )
    const notJson = Buffer.from('nope').toString('base64url')
    for (const bad of [
      forged,
      `${payload}.x${signature.slice(1)}`,
      `${payload}`,
      `${payload}.${signature}.extra`,
      '',
      `.${signature}`,
      createUnsubscribeToken({ subscriberId: 're_1' }),
      // Valid signature over bad payloads.
      `${empty}.${createReengageToken('x').split('.')[1]}`,
      `${notJson}.${signature}`,
    ]) {
      expect(verifyReengageToken(bad).ok).toBe(false)
    }
  })

  it('rejects a well-signed payload without an id', async () => {
    // Re-sign an empty id the same way the module does.
    const { createHmac } = await import('node:crypto')
    const { BETTER_AUTH_SECRET } = await import('@/lib/env/server')
    const sign = (b64: string) =>
      createHmac('sha256', BETTER_AUTH_SECRET)
        .update(`crm-newsletter-reengage:v1:${b64}`)
        .digest('base64url')
    for (const payload of [{ reengagementId: '' }, null, 'x']) {
      const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
      expect(verifyReengageToken(`${b64}.${sign(b64)}`).ok).toBe(false)
    }
    const raw = Buffer.from('not json').toString('base64url')
    expect(verifyReengageToken(`${raw}.${sign(raw)}`).ok).toBe(false)
  })

  it('builds the public page URL', () => {
    expect(newsletterReengageUrl('https://app.test/', 'tok')).toBe(
      'https://app.test/newsletter/continuar/tok',
    )
  })
})
