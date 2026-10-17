import { BETTER_AUTH_URL } from '@/lib/env/server'
import { MCP_SCOPES } from '@/src/lib/mcp/grant'

/**
 * Shared constants of the Steel OAuth provider (ADR 0033). `auth.ts`
 * configures the plugin with them and `resolveMcpGrant` reads tokens with
 * the same prefix and hash.
 */

/**
 * Prefixes on the opaque tokens the provider hands out. They are not stored
 * (the database keeps the SHA-256 of the rest) and make a leaked token easy
 * to spot by secret scanners.
 */
export const OAUTH_TOKEN_PREFIX = {
  opaqueAccessToken: 'stl_at_',
  refreshToken: 'stl_rt_',
  clientSecret: 'stl_cs_',
} as const

/** Scopes the provider accepts: the MCP ones plus refresh tokens. */
export const OAUTH_SCOPES = [...MCP_SCOPES, 'offline_access'] as const

/**
 * App origin without a trailing slash. Empty while env validation is skipped
 * (the Docker build collects page data without the runtime `.env`).
 */
export function appOrigin(): string {
  return (BETTER_AUTH_URL ?? '').replace(/\/+$/, '')
}

/** Better Auth's base URL, which is also the OAuth issuer. */
export function oauthIssuer(): string {
  return `${appOrigin()}/api/auth`
}

/** The protected resource: the MCP endpoint (`resource` in RFC 9728). */
export function mcpResourceUrl(): string {
  return `${appOrigin()}/api/mcp`
}

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) of the MCP endpoint —
 * where an MCP client learns which authorization server to use.
 */
export function protectedResourceMetadata() {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [oauthIssuer()],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Steel',
    resource_documentation: `${appOrigin()}/dev`,
  }
}

/**
 * Metadata documents are public and read by browser-based MCP clients too
 * (the MCP Inspector), so they answer any origin.
 */
export const METADATA_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, MCP-Protocol-Version',
} as const
