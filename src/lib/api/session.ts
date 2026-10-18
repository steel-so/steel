import type { ModuleKind } from '@prisma/client'
import { unauthorized } from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import { err, type Result } from '@/src/lib/result'

/**
 * Contract shared by the public API v1 slices (ADR 0035). `api-tokens` owns
 * the implementation of `resolveApiSession`; `api-v1` and `webhooks-out`
 * only consume it.
 */

export const API_SCOPES = ['api:read', 'api:write'] as const
export type ApiScope = (typeof API_SCOPES)[number]

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
 * longer members and suspended workspaces all return `unauthorized`.
 *
 * Placeholder until the `api-tokens` slice lands.
 */
export async function resolveApiSession(
  _request: Request,
): Promise<Result<ApiSession, AppError>> {
  return err(unauthorized('Token de API inválido'))
}
