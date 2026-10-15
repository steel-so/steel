import { createHash } from 'node:crypto'

/**
 * Anonymous visitor id of the site analytics (LGPD): a hash of the IP and
 * user agent salted with the site, the UTC day and a server secret. It counts
 * unique visitors per day, cannot be reversed to the IP and cannot follow a
 * person across days or sites. No cookie is involved.
 */
export function siteVisitorHash(input: {
  ip: string
  userAgent: string
  siteId: string
  secret: string
  now: Date
}): string {
  const day = input.now.toISOString().slice(0, 10)
  return createHash('sha256')
    .update(
      [input.secret, input.siteId, day, input.ip, input.userAgent].join('|'),
    )
    .digest('hex')
}

/** Only the host of the referrer (paths and queries may carry PII); `null`
 * for same-site navigation, garbage or non-http referrers. */
export function referrerHost(
  referrer: string | null | undefined,
  ownHost?: string | null,
): string | null {
  if (!referrer) return null
  try {
    const url = new URL(referrer)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    if (ownHost && host === ownHost.toLowerCase().replace(/:\d+$/, '')) {
      return null
    }
    return host
  } catch {
    return null
  }
}

/** First address of `X-Forwarded-For` (the client behind nginx). */
export function clientIp(forwardedFor: string | null | undefined): string {
  return forwardedFor?.split(',')[0]?.trim() || 'unknown'
}
