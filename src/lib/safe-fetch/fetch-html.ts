import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { isBlockedAddress, isBlockedHostname } from './ip'

/**
 * Hardened server-side fetch of an untrusted web page (site inspiration,
 * ADR 0071). Policy:
 *
 * - only `http:`/`https:`, no credentials in the URL, ports 80/443 only;
 * - the host is resolved here and EVERY address must be public; the socket
 *   is then opened to that very address (the request carries the original
 *   host in `Host`/SNI), so DNS cannot answer differently at connect time
 *   (no DNS rebinding window);
 * - redirects are followed by hand, at most 3, each hop validated again;
 * - 8 s for the whole fetch, answer cut at 1.5 MB, `text/html` and
 *   `application/xhtml+xml` only, no compression (no decompression bombs).
 *
 * The body is returned as text and never executed or rendered.
 */

export const SAFE_FETCH_TIMEOUT_MS = 8_000
export const SAFE_FETCH_MAX_BYTES = 1_500_000
export const SAFE_FETCH_MAX_REDIRECTS = 3
const ALLOWED_PORTS = new Set([80, 443])
const USER_AGENT = 'SteelSiteInspiration/1.0 (+https://steel.app)'

export type SafeFetchFailure =
  | 'invalid_url'
  | 'bad_scheme'
  | 'credentials_in_url'
  | 'bad_port'
  | 'blocked_host'
  | 'dns_failed'
  | 'too_many_redirects'
  | 'http_error'
  | 'not_html'
  | 'timeout'
  | 'network'

/** pt-BR reason shown next to a link that could not be read. */
export const SAFE_FETCH_MESSAGES: Record<SafeFetchFailure, string> = {
  invalid_url: 'Endereço inválido.',
  bad_scheme: 'Use um endereço http:// ou https://.',
  credentials_in_url: 'Não coloque usuário e senha no endereço.',
  bad_port: 'Só são aceitas as portas padrão (80 e 443).',
  blocked_host: 'Este endereço não é um site público.',
  dns_failed: 'Não encontramos esse domínio.',
  too_many_redirects: 'O endereço redireciona vezes demais.',
  http_error: 'O site respondeu com erro.',
  not_html: 'O endereço não é uma página da web.',
  timeout: 'O site demorou demais para responder.',
  network: 'Não foi possível conectar ao site.',
}

export type SafeFetchResult =
  | {
      ok: true
      html: string
      /** URL after redirects, query string and fragment removed. */
      finalUrl: string
      truncated: boolean
    }
  | { ok: false; reason: SafeFetchFailure; status?: number }

export interface TransportResponse {
  status: number
  headers: Record<string, string | undefined>
  body: AsyncIterable<Uint8Array>
  destroy: () => void
}

export interface TransportRequest {
  url: URL
  /** Validated address to open the socket to. */
  address: string
  family: 4 | 6
  headers: Record<string, string>
  signal: AbortSignal
}

export type Transport = (
  request: TransportRequest,
) => Promise<TransportResponse>

export type Resolver = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>

const defaultResolver: Resolver = (hostname) =>
  lookup(hostname, { all: true, verbatim: true })

/** Opens the socket to the already validated `address`. */
export const nodeTransport: Transport = (input) =>
  new Promise((resolve, reject) => {
    const secure = input.url.protocol === 'https:'
    const send = secure ? httpsRequest : httpRequest
    const req = send(
      {
        host: input.address,
        family: input.family,
        port: input.url.port || (secure ? 443 : 80),
        path: `${input.url.pathname}${input.url.search}`,
        method: 'GET',
        headers: { ...input.headers, host: input.url.host },
        // Certificate and SNI are checked against the original host name.
        ...(secure && !isIP(input.url.hostname)
          ? { servername: input.url.hostname }
          : {}),
        signal: input.signal,
      },
      (res) => {
        const headers: Record<string, string | undefined> = {}
        for (const [key, value] of Object.entries(res.headers)) {
          headers[key] = Array.isArray(value) ? value.join(', ') : value
        }
        resolve({
          status: res.statusCode ?? 0,
          headers,
          body: res,
          destroy: () => res.destroy(),
        })
      },
    )
    req.on('error', reject)
    req.end()
  })

/** Query string, fragment and credentials removed: safe to log or show. */
export function stripUrlForDisplay(raw: string): string {
  try {
    const url = new URL(raw)
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return ''
  }
}

export type Validated =
  | { ok: true; url: URL; address: string; family: 4 | 6 }
  | { ok: false; reason: SafeFetchFailure }

/**
 * The same checks `fetchHtml` runs on every hop (scheme, credentials, port,
 * host name, resolved addresses), for callers that drive their own network
 * stack (the reference-capture browser).
 */
export function validateFetchTarget(
  raw: string,
  resolver: Resolver = defaultResolver,
): Promise<Validated> {
  return validate(raw, resolver)
}

async function validate(raw: string, resolver: Resolver): Promise<Validated> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'bad_scheme' }
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'credentials_in_url' }
  }
  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80
  if (!ALLOWED_PORTS.has(port)) return { ok: false, reason: 'bad_port' }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || isBlockedHostname(host)) {
    return { ok: false, reason: 'blocked_host' }
  }
  if (isIP(host)) {
    if (isBlockedAddress(host)) return { ok: false, reason: 'blocked_host' }
    return { ok: true, url, address: host, family: isIP(host) === 6 ? 6 : 4 }
  }

  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await resolver(host)
  } catch {
    return { ok: false, reason: 'dns_failed' }
  }
  if (addresses.length === 0) return { ok: false, reason: 'dns_failed' }
  // One private answer taints the host: a rebinding record set mixes them.
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    return { ok: false, reason: 'blocked_host' }
  }
  const first = addresses[0]
  return {
    ok: true,
    url,
    address: first.address,
    family: first.family === 6 ? 6 : 4,
  }
}

async function readBody(
  response: TransportResponse,
  max: number,
): Promise<{ text: string; truncated: boolean }> {
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  for await (const chunk of response.body) {
    const room = max - size
    if (chunk.byteLength >= room) {
      chunks.push(chunk.subarray(0, room))
      size += room
      truncated = true
      response.destroy()
      break
    }
    chunks.push(chunk)
    size += chunk.byteLength
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder('utf-8').decode(bytes), truncated }
}

function isHtmlType(contentType: string | undefined): boolean {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase()
  return type === 'text/html' || type === 'application/xhtml+xml'
}

export async function fetchHtml(
  rawUrl: string,
  options: {
    transport?: Transport
    resolver?: Resolver
    timeoutMs?: number
    maxBytes?: number
  } = {},
): Promise<SafeFetchResult> {
  const transport = options.transport ?? nodeTransport
  const resolver = options.resolver ?? defaultResolver
  const signal = AbortSignal.timeout(options.timeoutMs ?? SAFE_FETCH_TIMEOUT_MS)
  let current = rawUrl

  for (let hop = 0; hop <= SAFE_FETCH_MAX_REDIRECTS; hop++) {
    const checked = await validate(current, resolver)
    if (!checked.ok) return checked

    let response: TransportResponse
    try {
      response = await transport({
        url: checked.url,
        address: checked.address,
        family: checked.family,
        signal,
        headers: {
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'accept-encoding': 'identity',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.5',
          'user-agent': USER_AGENT,
        },
      })
    } catch (cause) {
      return { ok: false, reason: failureOf(cause, signal) }
    }

    if (response.status >= 300 && response.status < 400) {
      response.destroy()
      const location = response.headers.location
      if (!location) {
        return { ok: false, reason: 'http_error', status: response.status }
      }
      try {
        current = new URL(location, checked.url).toString()
      } catch {
        return { ok: false, reason: 'invalid_url' }
      }
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      response.destroy()
      return { ok: false, reason: 'http_error', status: response.status }
    }
    if (!isHtmlType(response.headers['content-type'])) {
      response.destroy()
      return { ok: false, reason: 'not_html' }
    }

    try {
      const body = await readBody(
        response,
        options.maxBytes ?? SAFE_FETCH_MAX_BYTES,
      )
      return {
        ok: true,
        html: body.text,
        finalUrl: stripUrlForDisplay(checked.url.toString()),
        truncated: body.truncated,
      }
    } catch (cause) {
      return { ok: false, reason: failureOf(cause, signal) }
    }
  }
  return { ok: false, reason: 'too_many_redirects' }
}

function failureOf(cause: unknown, signal: AbortSignal): SafeFetchFailure {
  const name = cause instanceof Error ? cause.name : ''
  return signal.aborted || name === 'TimeoutError' || name === 'AbortError'
    ? 'timeout'
    : 'network'
}
