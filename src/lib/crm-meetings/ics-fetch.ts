import { readCapped } from '@/src/lib/crm-newsletter/feed-fetch'
import {
  assertPublicHttpsUrl,
  OutboundUrlError,
} from '@/src/lib/whatsapp/outbound-url'

/**
 * Server-side fetch of a seller's secret iCal address (Google / Outlook).
 * Same SSRF rules as the newsletter feed fetch: HTTPS only, public hosts,
 * redirects followed by hand (three at most, each hop checked again), 2 MB
 * and 8 seconds at most.
 */

export const ICS_FETCH_TIMEOUT_MS = 8000
export const ICS_MAX_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3

export type IcsFailure =
  | 'invalid_url'
  | 'not_https'
  | 'credentials_in_url'
  | 'private_host'
  | 'dns_failed'
  | 'http_error'
  | 'too_large'
  | 'timeout'
  | 'network'
  | 'not_a_calendar'

export type IcsFetchResult =
  | { ok: true; text: string }
  | { ok: false; reason: IcsFailure }

/** pt-BR reason shown next to the calendar field. */
export const ICS_FAILURE_MESSAGES: Record<IcsFailure, string> = {
  invalid_url: 'O endereço da agenda é inválido.',
  not_https: 'O endereço da agenda precisa começar com https:// (ou webcal://).',
  credentials_in_url: 'Não coloque usuário e senha no endereço da agenda.',
  private_host: 'O endereço aponta para uma rede privada. Use o endereço público da agenda.',
  dns_failed: 'Não foi possível encontrar o domínio da agenda.',
  http_error: 'O servidor da agenda respondeu com erro. Confira se o endereço secreto ainda vale.',
  too_large: 'A agenda passa de 2 MB.',
  timeout: 'O servidor da agenda demorou demais para responder.',
  network: 'Não foi possível conectar ao servidor da agenda.',
  not_a_calendar: 'O endereço não devolveu uma agenda no formato iCal (.ics).',
}

export function normalizeIcsUrl(raw: string): string {
  return raw.trim().replace(/^webcal:\/\//i, 'https://')
}

export async function fetchIcs(
  rawUrl: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<IcsFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const signal = AbortSignal.timeout(options.timeoutMs ?? ICS_FETCH_TIMEOUT_MS)
  let current = normalizeIcsUrl(rawUrl)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url: URL
    try {
      url = await assertPublicHttpsUrl(current)
    } catch (cause) {
      return {
        ok: false,
        reason: cause instanceof OutboundUrlError ? (cause.message as IcsFailure) : 'invalid_url',
      }
    }

    let response: Response
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1' },
      })
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : ''
      return {
        ok: false,
        reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
      }
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return { ok: false, reason: 'http_error' }
      current = new URL(location, url).toString()
      continue
    }
    if (!response.ok) return { ok: false, reason: 'http_error' }

    let text: string | null
    try {
      text = await readCapped(response, ICS_MAX_BYTES)
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : ''
      return {
        ok: false,
        reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
      }
    }
    if (text === null) return { ok: false, reason: 'too_large' }
    if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, reason: 'not_a_calendar' }
    return { ok: true, text }
  }
  return { ok: false, reason: 'http_error' }
}
