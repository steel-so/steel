import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { BETTER_AUTH_SECRET } from '@/lib/env/server'

/**
 * Open and click tracking of the cadence e-mail steps. Same idea as the
 * campaign links (ADR 0025): the token names the run row and is signed with
 * HMAC-SHA256 (own domain separation, 128 bits). A click token also signs
 * the destination URL, so `/c/<token>?u=<url>` can never be abused as an
 * open redirect. No expiry: an old e-mail keeps working.
 *
 * Open pixel: `<runId>.<sig>` · Click: `<runId>.<sig(runId|url)>`.
 */

const OPEN_DOMAIN = 'crm-cadence-open:v1'
const CLICK_DOMAIN = 'crm-cadence-click:v1'

function sign(domain: string, payload: string): string {
  return createHmac('sha256', BETTER_AUTH_SECRET)
    .update(`${domain}:${payload}`)
    .digest('base64url')
    .slice(0, 22)
}

function matches(domain: string, payload: string, signature: string): boolean {
  const given = Buffer.from(signature)
  const expected = Buffer.from(sign(domain, payload))
  return given.length === expected.length && timingSafeEqual(given, expected)
}

function split(token: string): { runId: string; signature: string } | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  return { runId: token.slice(0, dot), signature: token.slice(dot + 1) }
}

export function createCadenceOpenToken(runId: string): string {
  return `${runId}.${sign(OPEN_DOMAIN, runId)}`
}

/** Run id when the signature matches. */
export function verifyCadenceOpenToken(token: string): string | null {
  const parts = split(token)
  if (!parts) return null
  return matches(OPEN_DOMAIN, parts.runId, parts.signature) ? parts.runId : null
}

export function createCadenceClickToken(runId: string, url: string): string {
  return `${runId}.${sign(CLICK_DOMAIN, `${runId}|${url}`)}`
}

/** Run id when the signature covers exactly this destination. */
export function verifyCadenceClickToken(
  token: string,
  url: string,
): string | null {
  const parts = split(token)
  if (!parts) return null
  return matches(CLICK_DOMAIN, `${parts.runId}|${url}`, parts.signature)
    ? parts.runId
    : null
}

const trim = (baseUrl: string) => baseUrl.replace(/\/$/, '')

export function cadenceOpenPixelUrl(baseUrl: string, runId: string): string {
  return `${trim(baseUrl)}/api/crm/cadences/o/${createCadenceOpenToken(runId)}`
}

export function cadenceClickUrl(
  baseUrl: string,
  runId: string,
  url: string,
): string {
  return `${trim(baseUrl)}/api/crm/cadences/c/${createCadenceClickToken(runId, url)}?u=${encodeURIComponent(url)}`
}

/** Only web links are tracked (never `mailto:`, `tel:` or anchors). */
export function isTrackableUrl(url: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(url)
}

const HREF = /href="(https?:\/\/[^"]+)"/gi

/**
 * Points every web link of the e-mail HTML at the click redirect and adds
 * the open pixel at the end. The HTML comes from `cadenceTextToHtml`, whose
 * hrefs are HTML-escaped (`&amp;`), hence the decode/encode round trip.
 */
export function addCadenceTracking(
  html: string,
  runId: string,
  baseUrl: string,
): string {
  const tracked = html.replace(HREF, (whole, href: string) => {
    const url = href.replace(/&amp;/g, '&')
    if (!isTrackableUrl(url)) return whole
    return `href="${cadenceClickUrl(baseUrl, runId, url).replace(/&/g, '&amp;')}"`
  })
  const pixel = `<img src="${cadenceOpenPixelUrl(baseUrl, runId)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" />`
  return `${tracked}${pixel}`
}
