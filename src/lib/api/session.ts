import type { ModuleKind } from '@prisma/client'
import { unauthorized } from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import { apiTokenScopeRequired } from '@/src/errors/app-error'
import { parseBearerToken } from '@/src/lib/mcp/oauth-utils'
import { err, type Result } from '@/src/lib/result'

/**
 * Contract shared by the public API v1 slices (ADR 0035). `api-tokens` owns
 * the implementation of `resolveApiSession`; `api-v1` and `webhooks-out`
 * only consume it.
 */

export const API_SCOPES = ['api:read', 'api:write'] as const
export type ApiScope = (typeof API_SCOPES)[number]

/**
 * The refusal of a call that needs a scope the token lacks, shared by every
 * v1 route (`apiV1Route` and the webhook routes): `API_TOKEN_SCOPE_REQUIRED`
 * with `details.requiredScope`, so clients can say what to ask for.
 */
export function apiScopeRequiredError(requiredScope: ApiScope): AppError {
  return { ...apiTokenScopeRequired(), details: { requiredScope } }
}

/** What a personal API token (`stl_pat_...`) resolves to on every call. */
export interface ApiSession {
  tokenId: string
  userId: string
  workspaceId: string
  scopes: ApiScope[]
  /** Modules the token was created for; always a subset of the enabled ones. */
  modules: ModuleKind[]
  expiresAt: Date
}

/**
 * Resolves the `Authorization: Bearer stl_pat_...` header of a `/api/v1`
 * request. Missing, malformed, expired or revoked tokens, users who are no
 * longer members and suspended workspaces all return `unauthorized`. The
 * session cookie is never looked at.
 *
 * It also consumes the per-token rate limit (`apiTokenLimiter`, 300 calls
 * per minute): over it, `RATE_LIMITED` with `retryAfterSeconds`. Routes add
 * only the per-user `apiLimiter` on top.
 *
 * The lookup lives in `ApiTokenService.resolveToken`; it and the limiter
 * are imported lazily so this contract module stays light for its
 * consumers (and easy to mock in their tests).
 */
export async function resolveApiSession(
  request: Request,
): Promise<Result<ApiSession, AppError>> {
  const token = parseBearerToken(request.headers.get('authorization'))
  if (!token) return err(unauthorized('Token de API ausente'))

  const { ApiTokenService } = await import('@/src/services/api-token.service')
  const session = await ApiTokenService.resolveToken(token)
  if (!session.ok) return session

  const { apiTokenLimiter, consume } = await import('@/src/lib/rate-limit')
  const limit = await consume(apiTokenLimiter, `token:${session.value.tokenId}`)
  if (!limit.ok) return limit

  return session
}
