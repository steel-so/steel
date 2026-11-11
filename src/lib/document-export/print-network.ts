/**
 * Network guard of the PDF render (ADR 0063). Chromium runs inside the
 * worker, next to Postgres, Redis and MinIO, and prints HTML whose image and
 * font URLs come from the document author. Every request the page makes goes
 * through this check, so a document cannot pull an internal service into the
 * PDF (SSRF): only inline data and public http(s) hosts load.
 *
 * Hostnames are checked as written, not resolved; `trustedHosts` lists the
 * app's own public hosts (media proxy, MinIO public URL).
 */

const INLINE_PROTOCOLS = new Set(['data:', 'blob:', 'about:'])

/** Single-label names (Docker services such as `steel-minio`) and local TLDs. */
function isInternalName(hostname: string): boolean {
  return (
    !hostname.includes('.') ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  )
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : Number.NaN,
  )
  if (octets.some((octet) => Number.isNaN(octet) || octet > 255)) return null
  return octets
}

/** Loopback, private, link-local, CGNAT and "this network" ranges. */
function isPrivateIpv4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function isAllowedPrintRequest(
  url: string,
  trustedHosts: readonly string[] = [],
): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (INLINE_PROTOCOLS.has(parsed.protocol)) return true
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

  const hostname = parsed.hostname.toLowerCase()
  if (trustedHosts.includes(hostname)) return true
  // IPv6 literals (`[::1]`, `[fd00::1]`...) never point at a public CDN.
  if (hostname.startsWith('[')) return false
  if (hostname === 'localhost') return false

  const ipv4 = parseIpv4(hostname)
  if (ipv4) return !isPrivateIpv4(ipv4)
  return !isInternalName(hostname)
}
