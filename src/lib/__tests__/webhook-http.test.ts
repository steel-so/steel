import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  postWebhook,
  WEBHOOK_RESPONSE_EXCERPT,
  WEBHOOK_USER_AGENT,
} from '@/src/lib/webhooks/http'

const fetchMock = vi.fn()

function clock(...values: number[]) {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

describe('postWebhook', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('should POST the body with the headers, no redirects, and report a 2xx', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const result = await postWebhook({
      url: 'https://hooks.example.com',
      body: '{"a":1}',
      headers: { 'Steel-Signature': 'v1=x' },
      now: clock(1000, 1250),
    })
    expect(result).toEqual({
      ok: true,
      status: 204,
      responseBody: null,
      durationMs: 250,
      error: null,
    })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(init.body).toBe('{"a":1}')
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'User-Agent': WEBHOOK_USER_AGENT,
      'Steel-Signature': 'v1=x',
    })
  })

  it('should report a non-2xx with the first 1 KB of the answer', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response('x'.repeat(5000), { status: 500 }))
    const result = await postWebhook({
      url: 'https://hooks.example.com',
      body: '{}',
      headers: {},
    })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(500)
    expect(result.error).toBe('http_500')
    expect(result.responseBody).toHaveLength(WEBHOOK_RESPONSE_EXCERPT)
  })

  it('should treat a redirect as a failure (never followed)', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(null, { status: 302 }))
    const result = await postWebhook({
      url: 'https://hooks.example.com',
      body: '{}',
      headers: {},
    })
    expect(result).toMatchObject({ ok: false, status: 302, error: 'http_302' })
  })

  it('should report a timeout and a network error', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    fetchMock.mockRejectedValueOnce(timeout)
    expect(
      await postWebhook({
        url: 'https://h.example.com',
        body: '{}',
        headers: {},
      }),
    ).toMatchObject({ ok: false, status: null, error: 'timeout' })

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    expect(
      await postWebhook({
        url: 'https://h.example.com',
        body: '{}',
        headers: {},
      }),
    ).toMatchObject({ error: 'network_error: ECONNREFUSED' })

    fetchMock.mockRejectedValueOnce('boom')
    expect(
      await postWebhook({
        url: 'https://h.example.com',
        body: '{}',
        headers: {},
      }),
    ).toMatchObject({ error: 'network_error: boom' })
  })

  it('should survive an unreadable answer body', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue({
      status: 200,
      text: () => Promise.reject(new Error('stream closed')),
    })
    const result = await postWebhook({
      url: 'https://hooks.example.com',
      body: '{}',
      headers: {},
    })
    expect(result).toMatchObject({ ok: true, responseBody: null })
  })
})
