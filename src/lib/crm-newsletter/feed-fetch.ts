import {
  assertPublicHttpsUrl,
  OutboundUrlError,
} from '@/src/lib/whatsapp/outbound-url'
import { type ParsedFeed, parseFeed } from './feed'

/**
 * Server-side fetch of an external RSS/Atom feed for the newsletter digest
 * (newsletter2 nl2-digest-ai). SSRF protection reuses the outbound URL
 * guard of the webhooks (HTTPS only, no credentials, public host — literal
 * or every resolved address); redirects are followed by hand, at most
 * three, each hop checked again. The answer is cut at 1 MB and the whole
 * fetch at 8 seconds.
 */

export const FEED_FETCH_TIMEOUT_MS = 8000
export const FEED_MAX_BYTES = 1024 * 1024
export const FEED_MAX_REDIRECTS = 3

export type FeedFetchFailure =
  | 'invalid_url'
  | 'not_https'
  | 'credentials_in_url'
  | 'private_host'
  | 'dns_failed'
  | 'http_error'
  | 'too_large'
  | 'timeout'
  | 'network'
  | 'not_a_feed'

export type FeedFetchResult =
  | { ok: true; feed: ParsedFeed; url: string }
  | { ok: false; reason: FeedFetchFailure; status?: number }

/** pt-BR reason shown in the digest settings and the skip notice. */
export const FEED_FAILURE_MESSAGES: Record<FeedFetchFailure, string> = {
  invalid_url: 'O endereço do feed é inválido.',
  not_https: 'O feed precisa de um endereço https://.',
  credentials_in_url: 'Não coloque usuário e senha no endereço do feed.',
  private_host:
    'O feed aponta para um endereço privado ou local. Use um endereço público.',
  dns_failed: 'Não foi possível encontrar o domínio do feed.',
  http_error: 'O servidor do feed respondeu com erro.',
  too_large: 'O feed passa de 1 MB.',
  timeout: 'O servidor do feed demorou demais para responder.',
  network: 'Não foi possível conectar ao servidor do feed.',
  not_a_feed: 'O endereço não devolveu um feed RSS ou Atom.',
}

async function readCapped(
  response: Response,
  max: number,
): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > max) return null
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(bytes)
}

export async function fetchFeed(
  rawUrl: string,
  options: {
    fetchImpl?: typeof fetch
    timeoutMs?: number
    maxBytes?: number
  } = {},
): Promise<FeedFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const signal = AbortSignal.timeout(options.timeoutMs ?? FEED_FETCH_TIMEOUT_MS)
  let current = rawUrl
  for (let hop = 0; hop <= FEED_MAX_REDIRECTS; hop++) {
    let url: URL
    try {
      url = await assertPublicHttpsUrl(current)
    } catch (cause) {
      const reason =
        cause instanceof OutboundUrlError
          ? (cause.message as FeedFetchFailure)
          : 'invalid_url'
      return { ok: false, reason }
    }

    let response: Response
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: {
          accept:
            'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1',
          'user-agent': 'SteelNewsletterDigest/1.0 (+https://steel.app)',
        },
      })
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : ''
      return {
        ok: false,
        reason:
          name === 'TimeoutError' || name === 'AbortError'
            ? 'timeout'
            : 'network',
      }
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location)
        return { ok: false, reason: 'http_error', status: response.status }
      current = new URL(location, url).toString()
      continue
    }
    if (!response.ok) {
      return { ok: false, reason: 'http_error', status: response.status }
    }

    let text: string | null
    try {
      text = await readCapped(response, options.maxBytes ?? FEED_MAX_BYTES)
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : ''
      return {
        ok: false,
        reason:
          name === 'TimeoutError' || name === 'AbortError'
            ? 'timeout'
            : 'network',
      }
    }
    if (text === null) return { ok: false, reason: 'too_large' }
    const feed = parseFeed(text, url.toString())
    if (!feed) return { ok: false, reason: 'not_a_feed' }
    return { ok: true, feed, url: url.toString() }
  }
  return { ok: false, reason: 'http_error' }
}
