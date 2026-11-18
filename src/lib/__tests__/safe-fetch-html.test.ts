import { describe, expect, it, vi } from 'vitest'
import {
  fetchHtml,
  type Resolver,
  SAFE_FETCH_MAX_REDIRECTS,
  stripUrlForDisplay,
  type Transport,
  type TransportResponse,
} from '@/src/lib/safe-fetch/fetch-html'

const PUBLIC = [{ address: '93.184.216.34', family: 4 }]

function reply(
  status: number,
  headers: Record<string, string>,
  body: string | Uint8Array[] = '',
): TransportResponse {
  const chunks =
    typeof body === 'string' ? [new TextEncoder().encode(body)] : body
  return {
    status,
    headers,
    destroy: vi.fn(),
    body: (async function* () {
      for (const chunk of chunks) yield chunk
    })(),
  }
}

const html = (body = '<html><title>Oi</title></html>') =>
  reply(200, { 'content-type': 'text/html; charset=utf-8' }, body)

function setup(
  responses: Array<TransportResponse | Error>,
  resolve: Resolver = async () => PUBLIC,
) {
  const queue = [...responses]
  const transport = vi.fn<Transport>(async () => {
    const next = queue.shift()
    if (!next) throw new Error('no more responses')
    if (next instanceof Error) throw next
    return next
  })
  const resolver = vi.fn<Resolver>(resolve)
  return { transport, resolver }
}

describe('fetchHtml — URL policy', () => {
  it.each([
    ['not a url', 'invalid_url'],
    ['ftp://example.com/', 'bad_scheme'],
    ['file:///etc/passwd', 'bad_scheme'],
    ['javascript:alert(1)', 'bad_scheme'],
    ['https://user:pass@example.com/', 'credentials_in_url'],
    ['https://user@example.com/', 'credentials_in_url'],
    ['http://example.com:8080/', 'bad_port'],
    ['https://example.com:22/', 'bad_port'],
    ['http://localhost/', 'blocked_host'],
    ['http://admin.localhost/', 'blocked_host'],
    ['http://service.internal/', 'blocked_host'],
    ['http://127.0.0.1/', 'blocked_host'],
    ['http://2130706433/', 'blocked_host'],
    ['http://0x7f.1/', 'blocked_host'],
    ['http://169.254.169.254/latest/meta-data/', 'blocked_host'],
    ['http://[::1]/', 'blocked_host'],
    ['http://[::ffff:7f00:1]/', 'blocked_host'],
    ['http://[fd00:ec2::254]/', 'blocked_host'],
    ['http://10.0.0.5:80/', 'blocked_host'],
  ])('refuses %s without opening a connection (%s)', async (url, reason) => {
    const { transport, resolver } = setup([html()])
    const result = await fetchHtml(url, { transport, resolver })
    expect(result).toEqual({ ok: false, reason })
    expect(transport).not.toHaveBeenCalled()
  })

  it('accepts http and https on the standard ports', async () => {
    for (const url of [
      'http://example.com/',
      'https://example.com/',
      'https://example.com:443/',
      'http://example.com:80/x',
    ]) {
      const { transport, resolver } = setup([html()])
      const result = await fetchHtml(url, { transport, resolver })
      expect(result.ok).toBe(true)
    }
  })

  it('refuses a host when any resolved address is private (rebinding set)', async () => {
    const { transport, resolver } = setup([html()], async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    const result = await fetchHtml('https://rebind.example.com/', {
      transport,
      resolver,
    })
    expect(result).toEqual({ ok: false, reason: 'blocked_host' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('refuses a host that resolves to a private IPv6 address', async () => {
    const { transport, resolver } = setup([html()], async () => [
      { address: '::1', family: 6 },
    ])
    const result = await fetchHtml('https://v6.example.com/', {
      transport,
      resolver,
    })
    expect(result).toEqual({ ok: false, reason: 'blocked_host' })
  })

  it('reports DNS failures and empty answers', async () => {
    const failing = setup([html()], async () => {
      throw new Error('ENOTFOUND')
    })
    expect(await fetchHtml('https://nope.example.com/', failing)).toEqual({
      ok: false,
      reason: 'dns_failed',
    })
    const empty = setup([html()], async () => [])
    expect(await fetchHtml('https://nope.example.com/', empty)).toEqual({
      ok: false,
      reason: 'dns_failed',
    })
  })

  it('connects to the address it validated, not to a second lookup', async () => {
    const { transport, resolver } = setup([html()])
    await fetchHtml('https://example.com/a?token=secret', {
      transport,
      resolver,
    })
    expect(resolver).toHaveBeenCalledTimes(1)
    const sent = transport.mock.calls[0][0]
    expect(sent.address).toBe('93.184.216.34')
    expect(sent.family).toBe(4)
    expect(sent.headers['accept-encoding']).toBe('identity')
  })
})

describe('fetchHtml — redirects', () => {
  it('follows a public redirect and validates the new host', async () => {
    const { transport, resolver } = setup([
      reply(301, { location: 'https://www.example.com/home' }),
      html(),
    ])
    const result = await fetchHtml('http://example.com/', {
      transport,
      resolver,
    })
    expect(result).toMatchObject({
      ok: true,
      finalUrl: 'https://www.example.com/home',
    })
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it.each([
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:80/',
    'http://[::1]/',
    'file:///etc/passwd',
    'https://user:pw@example.com/',
    'https://example.com:8443/',
  ])('refuses a redirect to %s', async (target) => {
    const { transport, resolver } = setup([
      reply(302, { location: target }),
      html(),
    ])
    const result = await fetchHtml('https://example.com/', {
      transport,
      resolver,
    })
    expect(result.ok).toBe(false)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('refuses a redirect whose host resolves to a private address', async () => {
    const { transport, resolver } = setup(
      [reply(302, { location: 'https://evil.example.org/' }), html()],
      async (host) =>
        host === 'evil.example.org'
          ? [{ address: '10.0.0.7', family: 4 }]
          : PUBLIC,
    )
    const result = await fetchHtml('https://example.com/', {
      transport,
      resolver,
    })
    expect(result).toEqual({ ok: false, reason: 'blocked_host' })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('resolves relative redirects', async () => {
    const { transport, resolver } = setup([
      reply(302, { location: '/pt/' }),
      html(),
    ])
    const result = await fetchHtml('https://example.com/', {
      transport,
      resolver,
    })
    expect(result).toMatchObject({
      ok: true,
      finalUrl: 'https://example.com/pt/',
    })
  })

  it('gives up after three redirects', async () => {
    const hops = Array.from({ length: SAFE_FETCH_MAX_REDIRECTS + 1 }, (_, i) =>
      reply(302, { location: `https://example.com/${i + 1}` }),
    )
    const { transport, resolver } = setup([...hops, html()])
    const result = await fetchHtml('https://example.com/', {
      transport,
      resolver,
    })
    expect(result).toEqual({ ok: false, reason: 'too_many_redirects' })
    expect(transport).toHaveBeenCalledTimes(SAFE_FETCH_MAX_REDIRECTS + 1)
  })

  it('treats a redirect without Location as an HTTP error', async () => {
    const { transport, resolver } = setup([reply(302, {})])
    expect(
      await fetchHtml('https://example.com/', { transport, resolver }),
    ).toEqual({ ok: false, reason: 'http_error', status: 302 })
  })
})

describe('fetchHtml — response policy', () => {
  it('accepts text/html and application/xhtml+xml only', async () => {
    for (const type of ['text/html', 'application/xhtml+xml; charset=utf-8']) {
      const { transport, resolver } = setup([
        reply(200, { 'content-type': type }, 'x'),
      ])
      expect(
        (await fetchHtml('https://example.com/', { transport, resolver })).ok,
      ).toBe(true)
    }
    for (const type of [
      'application/json',
      'application/pdf',
      'image/png',
      'text/plain',
      'application/xml',
      '',
    ]) {
      const response = reply(200, { 'content-type': type }, 'x')
      const { transport, resolver } = setup([response])
      expect(
        await fetchHtml('https://example.com/', { transport, resolver }),
      ).toEqual({ ok: false, reason: 'not_html' })
      expect(response.destroy).toHaveBeenCalled()
    }
  })

  it('reports HTTP errors with the status', async () => {
    const { transport, resolver } = setup([
      reply(404, { 'content-type': 'text/html' }),
    ])
    expect(
      await fetchHtml('https://example.com/', { transport, resolver }),
    ).toEqual({ ok: false, reason: 'http_error', status: 404 })
  })

  it('cuts the body at the cap and stops reading', async () => {
    const big = reply(200, { 'content-type': 'text/html' }, [
      new Uint8Array(600).fill(97),
      new Uint8Array(600).fill(98),
      new Uint8Array(600).fill(99),
    ])
    const { transport, resolver } = setup([big])
    const result = await fetchHtml('https://example.com/', {
      transport,
      resolver,
      maxBytes: 1000,
    })
    expect(result.ok && result.truncated).toBe(true)
    expect(result.ok && result.html.length).toBe(1000)
    expect(big.destroy).toHaveBeenCalled()
  })

  it('does not flag a body under the cap as truncated', async () => {
    const { transport, resolver } = setup([html('<p>ok</p>')])
    const result = await fetchHtml('https://example.com/', {
      transport,
      resolver,
    })
    expect(result).toMatchObject({
      ok: true,
      html: '<p>ok</p>',
      truncated: false,
    })
  })

  it('maps timeouts and network errors', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'AbortError' })
    expect(await fetchHtml('https://example.com/', setup([timeout]))).toEqual({
      ok: false,
      reason: 'timeout',
    })
    expect(
      await fetchHtml('https://example.com/', setup([new Error('ECONNRESET')])),
    ).toEqual({ ok: false, reason: 'network' })
  })
})

describe('stripUrlForDisplay', () => {
  it('drops query, fragment and credentials', () => {
    expect(
      stripUrlForDisplay('https://u:p@Example.com/page?token=abc#frag'),
    ).toBe('https://example.com/page')
    expect(stripUrlForDisplay('https://example.com/')).toBe(
      'https://example.com',
    )
  })

  it('returns an empty string for garbage', () => {
    expect(stripUrlForDisplay('nope')).toBe('')
  })
})
