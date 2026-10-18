import type { ModuleKind } from '@prisma/client'
import { unauthorized } from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import { parseBearerToken } from '@/src/lib/mcp/oauth-utils'
import { err, type Result } from '@/src/lib/result'

/**
 * Contract shared by the MCP slices (ADR 0032/0033). `mcp-auth` owns the
 * implementation of `resolveMcpGrant`; `mcp-server` only consumes it.
 */

export const MCP_SCOPES = ['mcp:read', 'mcp:write'] as const
export type McpScope = (typeof MCP_SCOPES)[number]

/** What an OAuth access token resolves to on every MCP call. */
export interface McpGrant {
  grantId: string
  userId: string
  workspaceId: string
  /** OAuth client that holds the token (Claude, ChatGPT, Cursor…). */
  clientId: string
  clientName: string | null
  scopes: McpScope[]
  /** Modules the user consented to; always a subset of the enabled ones. */
  modules: ModuleKind[]
}

/**
 * Resolves the `Authorization: Bearer` header of an MCP request to its
 * grant. Missing, expired or revoked tokens, revoked grants and users who
 * are no longer members all return `unauthorized`.
 *
 * The lookup lives in `IntegrationGrantService.resolveAccessToken`; it is
 * imported lazily so this contract module stays light for its consumers
 * (and easy to mock in their tests).
 */
export async function resolveMcpGrant(
  request: Request,
): Promise<Result<McpGrant, AppError>> {
  const token = parseBearerToken(request.headers.get('authorization'))
  if (!token) return err(unauthorized('Token de integração ausente'))
  const { IntegrationGrantService } = await import(
    '@/src/services/integration-grant.service'
  )
  return IntegrationGrantService.resolveAccessToken(token)
}
