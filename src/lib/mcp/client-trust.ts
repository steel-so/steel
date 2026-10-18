/**
 * Who an OAuth client really is, as far as the consent screen can tell
 * (ADR 0033, "Atualização 2026-10-18"). Dynamic client registration lets
 * anyone register a client named "Claude", so the self-declared name is
 * never an identity. What the user can trust is where the authorization
 * code goes: the `redirect_uri` of the signed request, which the provider
 * already matched against the client's registered URIs.
 *
 * This module is pure: it classifies a redirect URI against a small
 * allowlist of known clients, matched by host — never by name.
 */

export type OAuthClientTrust = 'verified' | 'loopback' | 'unverified'

export interface OAuthDestination {
  trust: OAuthClientTrust
  /**
   * Where the browser goes after the consent, as the user should read it:
   * `host[:port]` in ASCII (IDNs stay in punycode, so a look-alike domain
   * cannot pass for the real one). Custom schemes read `scheme://host`.
   */
  host: string
  /** Name from the allowlist (never from the registration), when verified. */
  verifiedName: string | null
}

interface KnownClient {
  name: string
  /** Registrable domains; the domain itself and its subdomains match. */
  domains: readonly string[]
  /** Private-use URI schemes (RFC 8252 §7.1) handled by the native app. */
  schemes?: readonly string[]
}

/**
 * Known first-party / reputable MCP clients. Keep it short: every entry is
 * a promise to the user that a redirect to that host is that company.
 */
export const KNOWN_OAUTH_CLIENTS: readonly KnownClient[] = [
  { name: 'Claude', domains: ['claude.ai', 'claude.com'] },
  { name: 'ChatGPT', domains: ['chatgpt.com', 'openai.com'] },
  { name: 'Cursor', domains: ['cursor.com', 'cursor.sh'], schemes: ['cursor'] },
]

const WEB_SCHEMES = new Set(['http:', 'https:'])

/** `localhost`, `127.0.0.0/8` and `[::1]` (RFC 8252 §7.3). */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '[::1]') return true
  const octets = host.split('.')
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  )
}

function matchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

/**
 * Classifies a redirect URI. `null` when it is missing or not a URL. The
 * WHATWG parser does the hard part: userinfo (`https://claude.ai@evil.com`)
 * is not the host, IDNs come back in punycode and the port is separate.
 */
export function classifyRedirectUri(
  redirectUri: string | null | undefined,
): OAuthDestination | null {
  if (!redirectUri) return null
  let url: URL
  try {
    url = new URL(redirectUri)
  } catch {
    return null
  }

  const scheme = url.protocol.toLowerCase()
  // A trailing dot is the same DNS name (`claude.ai.` = `claude.ai`).
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  const port = url.port ? `:${url.port}` : ''

  if (!WEB_SCHEMES.has(scheme)) {
    const name = scheme.slice(0, -1)
    const known = KNOWN_OAUTH_CLIENTS.find((client) =>
      client.schemes?.includes(name),
    )
    return {
      trust: known ? 'verified' : 'unverified',
      host: `${name}://${hostname}${port}`,
      verifiedName: known?.name ?? null,
    }
  }

  if (!hostname) return null
  const host = `${hostname}${port}`

  if (isLoopbackHostname(hostname)) {
    return { trust: 'loopback', host, verifiedName: null }
  }

  // Only HTTPS proves the host; plain HTTP can be anyone on the network.
  const known =
    scheme === 'https:'
      ? KNOWN_OAUTH_CLIENTS.find((client) =>
          client.domains.some((domain) => matchesDomain(hostname, domain)),
        )
      : undefined
  return {
    trust: known ? 'verified' : 'unverified',
    host,
    verifiedName: known?.name ?? null,
  }
}

/**
 * The name the consent screen (and its LGPD notice) uses for the client.
 * Only a verified client is called by name; a loopback app keeps its
 * self-declared name (the code never leaves the user's machine); anything
 * else is identified by its host.
 */
export function consentClientLabel(
  destination: OAuthDestination,
  declaredName: string | null,
): string {
  if (destination.trust === 'verified' && destination.verifiedName) {
    return destination.verifiedName
  }
  if (destination.trust === 'loopback') {
    return declaredName?.trim() || 'app no seu computador'
  }
  return `app em ${destination.host}`
}
