import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/lib/whatsapp/outbound-url', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assertPublicHttpsUrl: vi.fn(),
}))

import {
  absoluteUrl,
  decodeEntities,
  htmlToText,
  parseFeed,
  parseFeedDate,
} from '@/src/lib/crm-newsletter/feed'
import {
  FEED_FAILURE_MESSAGES,
  fetchFeed,
} from '@/src/lib/crm-newsletter/feed-fetch'
import {
  assertPublicHttpsUrl,
  OutboundUrlError,
} from '@/src/lib/whatsapp/outbound-url'

const guard = vi.mocked(assertPublicHttpsUrl)

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Blog &amp; Novidades</title>
  <link>https://blog.acme.com.br</link>
  <!-- <item><title>comentado</title></item> -->
  <item>
    <title><![CDATA[Como escolher um plano & economizar]]></title>
    <link>https://blog.acme.com.br/planos</link>
    <description><![CDATA[<p>Um guia <strong>rápido</strong> com&nbsp;dicas.</p><img src="https://cdn.acme.com.br/capa.png">]]></description>
    <pubDate>Mon, 26 Oct 2026 12:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Webinar de novembro</title>
    <guid>https://blog.acme.com.br/webinar</guid>
    <description>Inscreva-se &#8212; vagas limitadas &#x2705;</description>
    <enclosure url="https://cdn.acme.com.br/webinar.jpg" type="image/jpeg" length="1"/>
    <pubDate>data inválida</pubDate>
  </item>
  <item>
    <title>Com mídia</title>
    <link>/relativo</link>
    <media:thumbnail url="https://cdn.acme.com.br/thumb.jpg"/>
    <dc:date>2026-10-20T10:00:00Z</dc:date>
  </item>
  <item>
    <title></title>
    <link>https://blog.acme.com.br/sem-titulo</link>
  </item>
  <item>
    <title>Sem link</title>
  </item>
</channel>
</rss>`

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Atom da Acme</title>
  <entry>
    <title type="html">Lançamento</title>
    <link rel="edit" href="https://blog.acme.com.br/edit/1"/>
    <link rel="alternate" href="https://blog.acme.com.br/lancamento"/>
    <summary>Resumo do lançamento.</summary>
    <published>2026-10-25T09:00:00Z</published>
    <media:content url="https://cdn.acme.com.br/l.png" medium="image"/>
  </entry>
  <entry>
    <title>Só atualizado</title>
    <link href='https://blog.acme.com.br/atualizado'/>
    <content type="html">&lt;p&gt;Conteúdo &lt;img src="https://cdn.acme.com.br/c.png"&gt;&lt;/p&gt;</content>
    <updated>2026-10-24T09:00:00Z</updated>
  </entry>
  <entry>
    <title>Sem link</title>
  </entry>
</feed>`

describe('feed parsing', () => {
  it('reads RSS 2.0 items: CDATA, entities, images, dates, drops broken ones', () => {
    const feed = parseFeed(RSS, 'https://blog.acme.com.br/feed')
    expect(feed?.title).toBe('Blog & Novidades')
    expect(feed?.items).toHaveLength(3)
    const [first, second, third] = feed?.items ?? []
    expect(first).toEqual({
      title: 'Como escolher um plano & economizar',
      url: 'https://blog.acme.com.br/planos',
      excerpt: 'Um guia rápido com dicas.',
      imageUrl: 'https://cdn.acme.com.br/capa.png',
      publishedAt: new Date('2026-10-26T12:00:00Z'),
    })
    expect(second.url).toBe('https://blog.acme.com.br/webinar')
    expect(second.excerpt).toBe('Inscreva-se — vagas limitadas ✅')
    expect(second.imageUrl).toBe('https://cdn.acme.com.br/webinar.jpg')
    expect(second.publishedAt).toBeNull()
    expect(third.url).toBe('https://blog.acme.com.br/relativo')
    expect(third.imageUrl).toBe('https://cdn.acme.com.br/thumb.jpg')
    expect(third.publishedAt?.toISOString()).toBe('2026-10-20T10:00:00.000Z')
  })

  it('reads Atom entries (alternate link, summary/content, published/updated)', () => {
    const feed = parseFeed(ATOM)
    expect(feed?.title).toBe('Atom da Acme')
    expect(feed?.items.map((item) => item.url)).toEqual([
      'https://blog.acme.com.br/lancamento',
      'https://blog.acme.com.br/atualizado',
    ])
    expect(feed?.items[0].imageUrl).toBe('https://cdn.acme.com.br/l.png')
    expect(feed?.items[0].publishedAt?.toISOString()).toBe(
      '2026-10-25T09:00:00.000Z',
    )
    expect(feed?.items[1].excerpt).toBe('Conteúdo')
    expect(feed?.items[1].imageUrl).toBe('https://cdn.acme.com.br/c.png')
    expect(feed?.items[1].publishedAt?.toISOString()).toBe(
      '2026-10-24T09:00:00.000Z',
    )
  })

  it('returns null for anything that is not a feed', () => {
    expect(parseFeed('<html><body>oi</body></html>')).toBeNull()
    expect(parseFeed('{"items": []}')).toBeNull()
  })

  it('caps excerpts at a word boundary and strips scripts', () => {
    const long = `<script>alert(1)</script>${'palavra '.repeat(100)}`
    const text = htmlToText(long, 50)
    expect(text.endsWith('…')).toBe(true)
    expect(text).not.toContain('alert')
    expect(text.length).toBeLessThanOrEqual(51)
    expect(htmlToText('x'.repeat(80), 50)).toBe(`${'x'.repeat(50)}…`)
  })

  it('decodes entities and leaves unknown or invalid ones', () => {
    expect(
      decodeEntities('&lt;b&gt; &quot;x&quot; &apos;y&apos; &hellip;'),
    ).toBe('<b> "x" \'y\' …')
    expect(decodeEntities('&foo; &#0; &#xZZ;')).toBe('&foo; &#0; &#xZZ;')
  })

  it('keeps only http(s) absolute URLs and valid dates', () => {
    expect(absoluteUrl(null)).toBeNull()
    expect(absoluteUrl('javascript:alert(1)')).toBeNull()
    expect(absoluteUrl('nao é url')).toBeNull()
    expect(absoluteUrl('/a', 'https://x.com/b')).toBe('https://x.com/a')
    expect(parseFeedDate(null)).toBeNull()
    expect(parseFeedDate('ontem')).toBeNull()
  })
})

function response(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers,
  })
}

describe('fetchFeed', () => {
  beforeEach(() => {
    guard.mockReset()
    guard.mockImplementation(async (raw: string) => new URL(raw))
  })

  it('fetches and parses a feed without following redirects automatically', async () => {
    const fetchImpl = vi.fn(async () => response(RSS))
    const result = await fetchFeed('https://blog.acme.com.br/feed', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.feed.items).toHaveLength(3)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://blog.acme.com.br/feed',
      expect.objectContaining({ redirect: 'manual', method: 'GET' }),
    )
  })

  it('follows a redirect by hand and checks the new host again', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response('', { status: 301, headers: { location: '/novo-feed' } }),
      )
      .mockResolvedValueOnce(response(ATOM))
    const result = await fetchFeed('https://blog.acme.com.br/feed', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toBe('https://blog.acme.com.br/novo-feed')
    expect(guard).toHaveBeenCalledTimes(2)
  })

  it('refuses a redirect into a private address', async () => {
    guard
      .mockResolvedValueOnce(new URL('https://blog.acme.com.br/feed'))
      .mockRejectedValueOnce(new OutboundUrlError('private_host'))
    const fetchImpl = vi.fn(async () =>
      response('', {
        status: 302,
        headers: { location: 'https://169.254.169.254/latest' },
      }),
    )
    const result = await fetchFeed('https://blog.acme.com.br/feed', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ ok: false, reason: 'private_host' })
  })

  it('maps guard refusals, including unexpected errors', async () => {
    guard.mockRejectedValueOnce(new OutboundUrlError('not_https'))
    expect(await fetchFeed('http://x.com')).toEqual({
      ok: false,
      reason: 'not_https',
    })
    guard.mockRejectedValueOnce(new Error('boom'))
    expect(await fetchFeed('https://x.com')).toEqual({
      ok: false,
      reason: 'invalid_url',
    })
  })

  it('stops after too many redirects or a redirect without location', async () => {
    const loop = vi.fn(async () =>
      response('', { status: 302, headers: { location: '/de-novo' } }),
    )
    expect(
      await fetchFeed('https://x.com/feed', {
        fetchImpl: loop as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: 'http_error' })
    expect(loop).toHaveBeenCalledTimes(4)
    const noLocation = vi.fn(async () => response('', { status: 302 }))
    expect(
      await fetchFeed('https://x.com/feed', {
        fetchImpl: noLocation as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: 'http_error', status: 302 })
  })

  it('reports HTTP errors, oversized bodies and non-feeds', async () => {
    const status = vi.fn(async () => response('nope', { status: 404 }))
    expect(
      await fetchFeed('https://x.com/feed', {
        fetchImpl: status as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: 'http_error', status: 404 })

    const declared = vi.fn(async () =>
      response('x', { headers: { 'content-length': '999999999' } }),
    )
    expect(
      await fetchFeed('https://x.com/feed', {
        fetchImpl: declared as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: 'too_large' })

    const streamed = vi.fn(async () => response('x'.repeat(2048)))
    expect(
      await fetchFeed('https://x.com/feed', {
        fetchImpl: streamed as unknown as typeof fetch,
        maxBytes: 1024,
      }),
    ).toEqual({ ok: false, reason: 'too_large' })

    const html = vi.fn(async () => response('<html></html>'))
    expect(
      await fetchFeed('https://x.com/feed', {
        fetchImpl: html as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: 'not_a_feed' })

    const empty = vi.fn(async () => new Response(null, { status: 200 }))
    expect(
      await fetchFeed('https://x.com/feed', {
        fetchImpl: empty as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: 'not_a_feed' })
  })

  it('maps timeouts and network failures', async () => {
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' })
    })
    expect(
      await fetchFeed('https://x.com/feed', {
        fetchImpl: timeout as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: 'timeout' })
    const network = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect(
      await fetchFeed('https://x.com/feed', {
        fetchImpl: network as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: 'network' })
  })

  it('maps failures while reading the body', async () => {
    const broken = (name: string) =>
      vi.fn(async () => {
        const body = new ReadableStream({
          pull() {
            throw Object.assign(new Error('x'), { name })
          },
        })
        return new Response(body, { status: 200 })
      })
    expect(
      await fetchFeed('https://x.com/feed', {
        fetchImpl: broken('AbortError') as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: 'timeout' })
    expect(
      await fetchFeed('https://x.com/feed', {
        fetchImpl: broken('Error') as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: 'network' })
  })

  it('has a pt-BR message for every failure', () => {
    for (const message of Object.values(FEED_FAILURE_MESSAGES)) {
      expect(message.length).toBeGreaterThan(5)
    }
  })
})
