import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup }))

import {
  BUTTON_WEBHOOK_EVENT,
  type ButtonWebhookBody,
  postButtonWebhook,
  signButtonWebhook,
} from '../whatsapp/button-webhook'
import {
  assertPublicHttpsUrl,
  isPrivateAddress,
  OutboundUrlError,
} from '../whatsapp/outbound-url'

beforeEach(() => {
  vi.restoreAllMocks()
  lookup.mockReset()
})

describe('isPrivateAddress', () => {
  it.each([
    '10.0.0.1',
    '127.0.0.1',
    '0.0.0.0',
    '100.64.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '::',
    '::1',
    '[::1]',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    'ff02::1',
    'not-an-ip',
  ])('refuses %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  it.each([
    '8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
  ])('accepts %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false)
  })
})

describe('assertPublicHttpsUrl', () => {
  async function reason(raw: string): Promise<string> {
    try {
      await assertPublicHttpsUrl(raw)
      return 'ok'
    } catch (error) {
      expect(error).toBeInstanceOf(OutboundUrlError)
      return (error as Error).message
    }
  }

  it('refuses malformed, http, credentials and local names', async () => {
    expect(await reason('nope')).toBe('invalid_url')
    expect(await reason('http://example.com')).toBe('not_https')
    expect(await reason('https://u:p@example.com')).toBe('credentials_in_url')
    expect(await reason('https://localhost/x')).toBe('private_host')
    expect(await reason('https://db.internal/x')).toBe('private_host')
    expect(await reason('https://10.0.0.5/x')).toBe('private_host')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('accepts a public literal without DNS', async () => {
    expect(await reason('https://8.8.8.8/hook')).toBe('ok')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('checks every resolved address', async () => {
    lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    expect(await reason('https://example.com/hook')).toBe('ok')

    lookup.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.1.1', family: 4 },
    ])
    expect(await reason('https://rebind.example/hook')).toBe('private_host')

    lookup.mockResolvedValueOnce([])
    expect(await reason('https://empty.example/hook')).toBe('private_host')

    lookup.mockRejectedValueOnce(new Error('ENOTFOUND'))
    expect(await reason('https://missing.example/hook')).toBe('dns_failed')
  })
})

const body: ButtonWebhookBody = {
  event: BUTTON_WEBHOOK_EVENT,
  workspaceId: 'ws1',
  conversationId: 'c1',
  contact: { waId: '5511', name: 'Ana' },
  button: { id: 'b1', label: 'Sim' },
  source: { type: 'TEMPLATE', id: 'tpl1' },
  clickedAt: '2026-10-14T12:00:00.000Z',
}

describe('postButtonWebhook', () => {
  it('signs the raw body with HMAC-SHA256', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))

    const result = await postButtonWebhook({
      url: 'https://8.8.8.8/hook',
      secret: 's3cret',
      body,
    })

    expect(result).toEqual({ status: 204 })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://8.8.8.8/hook')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const raw = init.body as string
    expect(JSON.parse(raw)).toEqual(body)
    const headers = init.headers as Record<string, string>
    expect(headers['X-Steel-Event']).toBe(BUTTON_WEBHOOK_EVENT)
    expect(headers['X-Steel-Signature']).toBe(
      `sha256=${createHmac('sha256', 's3cret').update(raw).digest('hex')}`,
    )
    expect(signButtonWebhook(raw, 's3cret')).toBe(headers['X-Steel-Signature'])
  })

  it('sends no signature without a secret', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    await postButtonWebhook({ url: 'https://8.8.8.8/hook', body })

    const headers = (fetchMock.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>
    expect(headers['X-Steel-Signature']).toBeUndefined()
  })

  it('throws on a non-2xx answer (redirects included)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 302 }),
    )
    await expect(
      postButtonWebhook({ url: 'https://8.8.8.8/hook', body }),
    ).rejects.toThrow('webhook_status_302')
  })

  it('never calls a private URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(
      postButtonWebhook({ url: 'https://127.0.0.1/hook', body }),
    ).rejects.toThrow('private_host')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
