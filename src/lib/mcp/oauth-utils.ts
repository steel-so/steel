import { createHash } from 'node:crypto'

/**
 * Pure helpers around the oauth-provider plugin's wire formats.
 */

/**
 * The value the plugin stores for an opaque token (`storeTokens: "hashed"`):
 * SHA-256 of the token without its prefix, base64url without padding.
 */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

/** `Authorization: Bearer <token>` → the token, or `null`. */
export function parseBearerToken(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim())
  return match?.[1] ?? null
}

export interface ParsedOAuthQuery {
  clientId: string
  scopes: string[]
  /**
   * `redirect_uri` of the request. The provider matched it against the
   * client's registered URIs before signing the query.
   */
  redirectUri: string | null
  /** `exp` of the signed query (seconds), when present. */
  expiresAt: Date | null
}

/**
 * Reads the signed query the plugin appends to `/oauth/consent`. This is a
 * read for display and pre-checks only — the plugin verifies the signature
 * when the consent is submitted.
 */
export function parseOAuthQuery(raw: string): ParsedOAuthQuery | null {
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw)
  const clientId = params.get('client_id')
  if (!clientId || !params.get('sig')) return null
  const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean)
  const exp = Number(params.get('exp'))
  return {
    clientId,
    scopes,
    redirectUri: params.get('redirect_uri') || null,
    expiresAt: Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000) : null,
  }
}

export function isOAuthQueryExpired(
  query: ParsedOAuthQuery,
  now: Date,
): boolean {
  return query.expiresAt !== null && query.expiresAt.getTime() <= now.getTime()
}
