import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * SSRF guard for URLs a workspace configures and the server calls (button
 * HTTP webhooks). Only HTTPS, no credentials in the URL, and the host — a
 * literal or every address it resolves to — must be public: loopback,
 * private, link-local, CGNAT and unique-local ranges are refused. The caller
 * also disables redirects so a public host cannot bounce into the network.
 */

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '')
  const version = isIP(ip)
  if (version === 4) return isPrivateV4(ip)
  if (version !== 6) return true
  if (ip === '::' || ip === '::1') return true
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateV4(mapped[1])
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(ip)
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal']

export class OutboundUrlError extends Error {}

/** Resolves the URL and throws `OutboundUrlError` when it is not allowed. */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new OutboundUrlError('invalid_url')
  }
  if (url.protocol !== 'https:') throw new OutboundUrlError('not_https')
  if (url.username || url.password) {
    throw new OutboundUrlError('credentials_in_url')
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    throw new OutboundUrlError('private_host')
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new OutboundUrlError('private_host')
    return url
  }

  let addresses: { address: string }[]
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    throw new OutboundUrlError('dns_failed')
  }
  if (
    addresses.length === 0 ||
    addresses.some((entry) => isPrivateAddress(entry.address))
  ) {
    throw new OutboundUrlError('private_host')
  }
  return url
}
