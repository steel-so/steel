import { crmProspectWebFailed } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { checkWebhookUrl, webhookUrlError } from '@/src/lib/webhooks/url-guard'

/**
 * Generic page fetch for the prospecting agent (T5), hardened against SSRF
 * the same way as the webhooks (ADR 0036): HTTPS only, no credentials in the
 * URL, public hosts only. Redirects are followed by hand (at most
 * `MAX_REDIRECTS`) and every hop is checked again, so a public page cannot
 * bounce into the internal network. The body is read as a stream and cut at
 * `MAX_BYTES`; only text-like content types are accepted.
 */

export const WEB_FETCH_TIMEOUT_MS = 12_000
export const WEB_FETCH_MAX_BYTES = 1_500_000
export const WEB_FETCH_MAX_REDIRECTS = 3
/** Text handed to the model from one page. */
export const WEB_FETCH_MAX_TEXT_CHARS = 12_000

const TEXT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'application/json',
  'application/xml',
  'text/xml',
]

export interface FetchedPage {
  /** URL requested. */
  url: string
  /** URL of the last hop. */
  finalUrl: string
  title: string | null
  /** Readable text, cut at `WEB_FETCH_MAX_TEXT_CHARS`. */
  text: string
  truncated: boolean
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

function decodeEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d{1,8});/g, (_, code: string) => {
      const n = Number(code)
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '
    })
}

export function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!match) return null
  const title = decodeEntities(match[1]).replace(/\s+/g, ' ').trim()
  return title === '' ? null : title.slice(0, 200)
}

/** HTML to readable text: scripts, styles and tags go; blocks become lines. */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(stripped)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader()
  if (!reader) return { text: await response.text(), truncated: false }
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let received = 0
  let text = ''
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      const keep = value.byteLength - (received - maxBytes)
      text += decoder.decode(value.subarray(0, Math.max(0, keep)))
      truncated = true
      await reader.cancel().catch(() => undefined)
      break
    }
    text += decoder.decode(value, { stream: true })
  }
  return { text, truncated }
}

export interface FetchPageOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
}

export async function fetchPage(
  rawUrl: string,
  options: FetchPageOptions = {},
): Promise<Result<FetchedPage>> {
  const fetchImpl = options.fetchImpl ?? fetch
  const maxRedirects = options.maxRedirects ?? WEB_FETCH_MAX_REDIRECTS
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? WEB_FETCH_TIMEOUT_MS,
  )
  try {
    let current = rawUrl
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const checked = await checkWebhookUrl(current)
      if (!checked.ok) {
        return err(crmProspectWebFailed(webhookUrlError(checked.reason).message))
      }
      const response = await fetchImpl(checked.url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
          'User-Agent': 'SteelProspecting/1.0',
        },
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          return err(crmProspectWebFailed('Redirecionamento sem destino'))
        }
        try {
          current = new URL(location, checked.url).toString()
        } catch {
          return err(crmProspectWebFailed('Redirecionamento inválido'))
        }
        continue
      }
      if (!response.ok) {
        return err(
          crmProspectWebFailed(`A página respondeu ${response.status}`),
        )
      }
      const type = (response.headers.get('content-type') ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase()
      if (type !== '' && !TEXT_TYPES.includes(type)) {
        return err(
          crmProspectWebFailed(`Tipo de conteúdo não suportado (${type})`),
        )
      }
      const body = await readCapped(
        response,
        options.maxBytes ?? WEB_FETCH_MAX_BYTES,
      )
      const isHtml = type === '' || type.includes('html')
      const text = isHtml ? htmlToText(body.text) : body.text.trim()
      const clipped = text.length > WEB_FETCH_MAX_TEXT_CHARS
      return ok({
        url: rawUrl,
        finalUrl: checked.url.toString(),
        title: isHtml ? extractTitle(body.text) : null,
        text: clipped ? text.slice(0, WEB_FETCH_MAX_TEXT_CHARS) : text,
        truncated: body.truncated || clipped,
      })
    }
    return err(crmProspectWebFailed('Redirecionamentos demais'))
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError'
    return err(
      crmProspectWebFailed(
        aborted
          ? 'A página demorou demais para responder'
          : 'Não foi possível abrir a página',
      ),
    )
  } finally {
    clearTimeout(timer)
  }
}
