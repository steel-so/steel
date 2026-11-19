import {
  BETTER_AUTH_URL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
} from '@/lib/env/server'
import { ok, type Result } from '@/src/lib/result'
import { isTokenCryptoConfigured } from '@/src/lib/social/crypto'
import {
  expiresInToDate,
  getJson,
  postForm,
} from '@/src/lib/social/providers/http'
import type { TokenSet } from '@/src/lib/social/providers/types'

/**
 * Google OAuth 2.0 for the Business Profile APIs. Reuses the same Google
 * client (GOOGLE_CLIENT_ID/SECRET) as Analytics and Ads; the scope is the
 * single `business.manage` one (Account Management, Business Information,
 * Performance and the legacy v4 reviews/media APIs all accept it), plus
 * `openid email` just to show which Google account is connected.
 *
 * Redirect URI to register on the Google client:
 * `<BETTER_AUTH_URL>/api/google-business/callback`.
 */

export const GOOGLE_BUSINESS_SCOPE =
  'https://www.googleapis.com/auth/business.manage'
const SCOPES = [GOOGLE_BUSINESS_SCOPE, 'openid', 'email']

export function googleBusinessCallbackUrl(): string {
  return `${BETTER_AUTH_URL.replace(/\/$/, '')}/api/google-business/callback`
}

/** Credentials and token encryption key present on the server? */
export function isGoogleBusinessConfigured(): boolean {
  return Boolean(
    GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && isTokenCryptoConfigured(),
  )
}

/** Did the granted scope string include Business Profile access? */
export function hasBusinessScope(scope: string | null | undefined): boolean {
  return (scope ?? '').includes('business.manage')
}

export function buildGoogleBusinessAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID ?? '',
    redirect_uri: googleBusinessCallbackUrl(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    // Always ask for consent so Google returns a refresh token again when the
    // workspace reconnects.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

export async function exchangeGoogleBusinessCode(
  code: string,
): Promise<Result<TokenSet>> {
  const result = await postForm<TokenResponse>(
    'https://oauth2.googleapis.com/token',
    {
      client_id: GOOGLE_CLIENT_ID ?? '',
      client_secret: GOOGLE_CLIENT_SECRET ?? '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: googleBusinessCallbackUrl(),
    },
  )
  if (!result.ok) return result
  return ok({
    accessToken: result.value.access_token,
    refreshToken: result.value.refresh_token ?? null,
    expiresAt: expiresInToDate(result.value.expires_in),
    scope: result.value.scope ?? null,
  })
}

export async function refreshGoogleBusinessToken(
  refreshToken: string,
): Promise<Result<TokenSet>> {
  const result = await postForm<TokenResponse>(
    'https://oauth2.googleapis.com/token',
    {
      client_id: GOOGLE_CLIENT_ID ?? '',
      client_secret: GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    },
  )
  if (!result.ok) return result
  return ok({
    accessToken: result.value.access_token,
    refreshToken: result.value.refresh_token ?? null,
    expiresAt: expiresInToDate(result.value.expires_in),
    scope: result.value.scope ?? null,
  })
}

/** Best-effort revocation of the grant when the workspace disconnects. */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    })
  } catch {
    // Nothing to do: the local connection is removed either way.
  }
}

/** E-mail of the connected Google account (display only; `null` on failure). */
export async function fetchGoogleEmail(
  accessToken: string,
): Promise<string | null> {
  const result = await getJson<{ email?: string }>(
    'https://openidconnect.googleapis.com/v1/userinfo',
    accessToken,
  )
  return result.ok ? (result.value.email ?? null) : null
}
