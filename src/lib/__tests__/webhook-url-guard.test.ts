import { beforeEach, describe, expect, it, vi } from 'vitest'

const lookup = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ lookup, default: { lookup } }))

import { checkWebhookUrl, webhookUrlError } from '@/src/lib/webhooks/url-guard'

describe('checkWebhookUrl (SSRF guard)', () => {
  beforeEach(() => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  })

  it('should accept a public HTTPS URL', async () => {
    const result = await checkWebhookUrl('https://hooks.example.com/steel')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url.hostname).toBe('hooks.example.com')
  })

  it.each([
    ['not a url', 'invalid_url'],
    ['http://hooks.example.com', 'not_https'],
    ['https://user:pass@hooks.example.com', 'credentials_in_url'],
    ['https://localhost/hook', 'private_host'],
    ['https://127.0.0.1/hook', 'private_host'],
    ['https://10.0.0.5/hook', 'private_host'],
    ['https://169.254.169.254/latest', 'private_host'],
    ['https://[::1]/hook', 'private_host'],
    ['https://printer.internal/hook', 'private_host'],
  ])('should refuse %s (%s)', async (url, reason) => {
    expect(await checkWebhookUrl(url)).toEqual({ ok: false, reason })
  })

  it('should refuse a name that resolves to a private address', async () => {
    lookup.mockResolvedValue([{ address: '192.168.0.10', family: 4 }])
    expect(await checkWebhookUrl('https://evil.example.com')).toEqual({
      ok: false,
      reason: 'private_host',
    })
  })

  it('should refuse a name that does not resolve', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'))
    expect(await checkWebhookUrl('https://nope.example.com')).toEqual({
      ok: false,
      reason: 'dns_failed',
    })
  })

  it('should turn a refusal into WEBHOOK_URL_NOT_ALLOWED with a pt-BR reason', () => {
    const error = webhookUrlError('not_https')
    expect(error.code).toBe('WEBHOOK_URL_NOT_ALLOWED')
    expect(error.message).toBe('A URL precisa começar com https://.')
  })
})
