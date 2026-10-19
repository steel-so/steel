import { describe, expect, it } from 'vitest'
import {
  apolloWebhookToken,
  buildApolloWebhookUrl,
  hashApolloWebhookToken,
  isApolloPhoneRevealAvailable,
} from '../integrations/apollo-webhook'

describe('apollo webhook helpers', () => {
  it('derives a stable, per-import, url-safe token', () => {
    const a = apolloWebhookToken('imp1')
    expect(a).toBe(apolloWebhookToken('imp1'))
    expect(a).not.toBe(apolloWebhookToken('imp2'))
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('hashes the token to a sha-256 hex digest', () => {
    const hash = hashApolloWebhookToken('abc')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(hashApolloWebhookToken('abc'))
    expect(hash).not.toContain('abc')
  })

  it('only offers phones on an https public url', () => {
    expect(isApolloPhoneRevealAvailable('https://steel.example.com')).toBe(true)
    expect(isApolloPhoneRevealAvailable('http://steel.example.com')).toBe(false)
    expect(isApolloPhoneRevealAvailable()).toBe(false) // test env is http
  })

  it('builds the webhook url without a double slash', () => {
    expect(buildApolloWebhookUrl('tok', 'https://steel.example.com/')).toBe(
      'https://steel.example.com/api/crm/apollo/webhook/tok',
    )
    expect(buildApolloWebhookUrl('tok')).toContain('/api/crm/apollo/webhook/tok')
  })
})
