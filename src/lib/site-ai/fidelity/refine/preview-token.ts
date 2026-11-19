import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Signed, short-lived access to the preview of a draft site (ADR 0072).
 * The token is `<id>.<expires>.<signature>`: `id` names the draft kept in
 * Redis, `expires` is a Unix time in seconds and the signature is an HMAC
 * of both with the app secret. The preview page and the capture's network
 * policy both verify it, so only the app (which holds the secret) can open
 * a preview, and only for a few minutes.
 */

export const PREVIEW_TOKEN_TTL_SECONDS = 20 * 60
export const PREVIEW_PATH_PREFIX = '/site-preview/'

const TOKEN_PATTERN = /^([0-9a-f]{32})\.(\d{1,12})\.([0-9a-f]{40})$/

function sign(secret: string, id: string, expires: number): string {
  return createHmac('sha256', secret)
    .update(`site-preview:${id}.${expires}`)
    .digest('hex')
    .slice(0, 40)
}

export interface PreviewToken {
  token: string
  id: string
  expiresAt: number
}

export function createPreviewToken(
  secret: string,
  nowMs: number = Date.now(),
  ttlSeconds: number = PREVIEW_TOKEN_TTL_SECONDS,
): PreviewToken {
  const id = randomBytes(16).toString('hex')
  const expiresAt = Math.floor(nowMs / 1000) + ttlSeconds
  return {
    token: `${id}.${expiresAt}.${sign(secret, id, expiresAt)}`,
    id,
    expiresAt,
  }
}

/** The draft id of a valid, unexpired token; `null` otherwise. */
export function verifyPreviewToken(
  secret: string,
  token: string,
  nowMs: number = Date.now(),
): string | null {
  const match = TOKEN_PATTERN.exec(token)
  if (!match) return null
  const [, id, rawExpires, signature] = match
  const expires = Number(rawExpires)
  if (!Number.isSafeInteger(expires) || expires * 1000 < nowMs) return null
  const expected = Buffer.from(sign(secret, id, expires))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null
  }
  return id
}

/** Path (with the page index) the preview of `token` is served at. */
export function previewPath(token: string, pageIndex: number): string {
  return `${PREVIEW_PATH_PREFIX}${token}?p=${Math.max(0, Math.floor(pageIndex))}`
}

/**
 * Token inside a preview URL, when `url` is one on `origin` (no check of
 * the signature). Used to recognize the app's own preview URLs.
 */
export function previewTokenOfUrl(url: string, origin: string): string | null {
  let parsed: URL
  let base: URL
  try {
    parsed = new URL(url)
    base = new URL(origin)
  } catch {
    return null
  }
  if (parsed.origin !== base.origin) return null
  if (!parsed.pathname.startsWith(PREVIEW_PATH_PREFIX)) return null
  const token = parsed.pathname.slice(PREVIEW_PATH_PREFIX.length)
  return TOKEN_PATTERN.test(token) ? token : null
}

/**
 * Origin the worker should open for a preview job. The job carries the
 * app's public URL (`BETTER_AUTH_URL`); the worker reaches the app through
 * its own address (`STATUS_APP_PROBE_URL`, the Docker network name in
 * production). Returns `null` when `url` is not a valid signed preview of
 * the public origin — then the capture is a plain external one.
 */
export function resolveInternalPreview(
  url: string,
  input: { publicOrigin: string; internalOrigin: string; secret: string },
  nowMs: number = Date.now(),
): { url: string; origin: string } | null {
  const token = previewTokenOfUrl(url, input.publicOrigin)
  if (!token) return null
  if (verifyPreviewToken(input.secret, token, nowMs) === null) return null
  const parsed = new URL(url)
  const internal = new URL(input.internalOrigin)
  return {
    url: `${internal.origin}${parsed.pathname}${parsed.search}`,
    origin: internal.origin,
  }
}
