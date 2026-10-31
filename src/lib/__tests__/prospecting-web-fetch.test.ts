import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

vi.mock('@/src/lib/webhooks/url-guard', () => ({
  checkWebhookUrl: vi.fn(),
  webhookUrlError: vi.fn((reason: string) => ({
    code: 'WEBHOOK_URL_NOT_ALLOWED',
    message: `refused:${reason}`,
  })),
}))

import { checkWebhookUrl } from '@/src/lib/webhooks/url-guard'
import {
  extractTitle,
  fetchPage,
  htmlToText,
  WEB_FETCH_MAX_TEXT_CHARS,
} from '../prospecting/web-fetch'

const guard = vi.mocked(checkWebhookUrl)

function response(
  body: string,
  init: { status?: number; type?: string; location?: string } = {},
) {
  const headers = new Headers()
  if (init.type !== null) {
    headers.set('content-type', init.type ?? 'text/html; charset=utf-8')
  }
  if (init.location) headers.set('location', init.location)
  return new Response(body, { status: init.status ?? 200, headers })
}

beforeEach(() => {
  vi.resetAllMocks()
  guard.mockImplementation(async (raw: string) => ({
    ok: true,
    url: new URL(raw),
  }))
})

describe('htmlToText() and extractTitle()', () => {
  it('should drop scripts, styles and tags and decode entities', () => {
    const html =
      '<html><head><title> Acme &amp; Cia </title><style>p{}</style></head><body><script>alert(1)</script><p>Olá&nbsp;mundo</p><div>Linha&#233;</div><!-- x --></body></html>'
    expect(extractTitle(html)).toBe('Acme & Cia')
    const text = htmlToText(html)
    expect(text).toContain('Olá mundo')
    expect(text).toContain('Linhaé')
    expect(text).not.toContain('alert')
    expect(text).not.toContain('<')
  })

  it('should return null without a title and ignore invalid code points', () => {
    expect(extractTitle('<p>x</p>')).toBeNull()
    expect(extractTitle('<title>   </title>')).toBeNull()
    expect(htmlToText('a&#9999999;b')).toBe('a b')
  })
})

describe('fetchPage()', () => {
  it('should read a public HTML page', async () => {
    const fetchImpl = vi.fn(async () =>
      response('<title>Início</title><p>Estamos contratando</p>'),
    )
    const page = expectOk(
      await fetchPage('https://acme.com.br/', { fetchImpl }),
    )
    expect(page.title).toBe('Início')
    expect(page.text).toContain('Estamos contratando')
    expect(page.truncated).toBe(false)
    expect(page.finalUrl).toBe('https://acme.com.br/')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://acme.com.br/',
      expect.objectContaining({ redirect: 'manual', method: 'GET' }),
    )
  })

  it('should refuse a URL the SSRF guard refuses, without calling fetch', async () => {
    guard.mockResolvedValue({ ok: false, reason: 'private_host' })
    const fetchImpl = vi.fn()
    const error = expectErr(
      await fetchPage('https://10.0.0.1/', { fetchImpl }),
      'CRM_PROSPECT_WEB_FAILED',
    )
    expect(error.message).toContain('private_host')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('should follow redirects by hand and check every hop', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response('', { status: 301, location: '/novo', type: 'text/plain' }),
      )
      .mockResolvedValueOnce(response('<p>Destino</p>'))
    const page = expectOk(
      await fetchPage('https://acme.com.br/antigo', { fetchImpl }),
    )
    expect(page.finalUrl).toBe('https://acme.com.br/novo')
    expect(guard).toHaveBeenCalledTimes(2)
  })

  it('should stop a redirect into a private host', async () => {
    guard.mockImplementation(async (raw: string) =>
      raw.includes('internal')
        ? { ok: false, reason: 'private_host' }
        : { ok: true, url: new URL(raw) },
    )
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        response('', { status: 302, location: 'https://internal.local/x' }),
      )
    expectErr(
      await fetchPage('https://acme.com.br/', { fetchImpl }),
      'CRM_PROSPECT_WEB_FAILED',
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('should fail on a redirect without destination, with a bad one, or too many', async () => {
    const missing = vi.fn(async () => response('', { status: 302 }))
    expectErr(
      await fetchPage('https://acme.com.br/', { fetchImpl: missing }),
      'CRM_PROSPECT_WEB_FAILED',
    )
    const bad = vi.fn(async () =>
      response('', { status: 302, location: 'http://[bad' }),
    )
    expectErr(
      await fetchPage('https://acme.com.br/', { fetchImpl: bad }),
      'CRM_PROSPECT_WEB_FAILED',
    )
    const loop = vi.fn(async () =>
      response('', { status: 302, location: '/loop' }),
    )
    const error = expectErr(
      await fetchPage('https://acme.com.br/', {
        fetchImpl: loop,
        maxRedirects: 2,
      }),
    )
    expect(error.message).toContain('Redirecionamentos demais')
    expect(loop).toHaveBeenCalledTimes(3)
  })

  it('should report non-2xx answers and unsupported content types', async () => {
    const notFound = vi.fn(async () => response('x', { status: 404 }))
    expect(
      expectErr(
        await fetchPage('https://acme.com.br/', { fetchImpl: notFound }),
      ).message,
    ).toContain('404')
    const pdf = vi.fn(async () =>
      response('%PDF', { type: 'application/pdf' }),
    )
    expect(
      expectErr(await fetchPage('https://acme.com.br/', { fetchImpl: pdf }))
        .message,
    ).toContain('application/pdf')
  })

  it('should keep plain text and JSON as they are, without a title', async () => {
    const fetchImpl = vi.fn(async () =>
      response('  {"a":1}  ', { type: 'application/json' }),
    )
    const page = expectOk(
      await fetchPage('https://acme.com.br/a.json', { fetchImpl }),
    )
    expect(page.text).toBe('{"a":1}')
    expect(page.title).toBeNull()
  })

  it('should treat a missing content type as HTML', async () => {
    const fetchImpl = vi.fn(async () =>
      response('<p>Sem tipo</p>', { type: null as unknown as string }),
    )
    const page = expectOk(
      await fetchPage('https://acme.com.br/', { fetchImpl }),
    )
    expect(page.text).toBe('Sem tipo')
  })

  it('should cut the body at the byte limit', async () => {
    const fetchImpl = vi.fn(async () => response(`<p>${'a'.repeat(5000)}</p>`))
    const page = expectOk(
      await fetchPage('https://acme.com.br/', { fetchImpl, maxBytes: 1000 }),
    )
    expect(page.truncated).toBe(true)
    expect(page.text.length).toBeLessThanOrEqual(1000)
  })

  it('should cut the text handed to the model', async () => {
    const fetchImpl = vi.fn(async () =>
      response(`<p>${'palavra '.repeat(5000)}</p>`),
    )
    const page = expectOk(
      await fetchPage('https://acme.com.br/', { fetchImpl }),
    )
    expect(page.text).toHaveLength(WEB_FETCH_MAX_TEXT_CHARS)
    expect(page.truncated).toBe(true)
  })

  it('should read a body that has no stream', async () => {
    const fake = {
      status: 200,
      ok: true,
      headers: new Headers({ 'content-type': 'text/plain' }),
      body: null,
      text: async () => 'texto',
    } as unknown as Response
    const page = expectOk(
      await fetchPage('https://acme.com.br/', { fetchImpl: async () => fake }),
    )
    expect(page.text).toBe('texto')
  })

  it('should turn network errors and timeouts into a domain error', async () => {
    const boom = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    expect(
      expectErr(await fetchPage('https://acme.com.br/', { fetchImpl: boom }))
        .message,
    ).toBe('Não foi possível abrir a página')

    const abort = vi.fn(async () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    })
    expect(
      expectErr(await fetchPage('https://acme.com.br/', { fetchImpl: abort }))
        .message,
    ).toBe('A página demorou demais para responder')
  })
})
