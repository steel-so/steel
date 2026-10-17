import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { resolveToolAccess } from '@/src/lib/ai/tools/registry'
import { resolveMcpGrant } from '@/src/lib/mcp/grant'
import {
  isStaleGrantError,
  mcpMethodNotAllowed,
  mcpUnauthorized,
} from '@/src/lib/mcp/http'
import { handleMcpRequest } from '@/src/lib/mcp/server'
import { consume, mcpClientLimiter, mcpUserLimiter } from '@/src/lib/rate-limit'
import { handleError } from '@/utils/http-response'

/**
 * Public MCP server (ADR 0032): Streamable HTTP without sessions. The proxy
 * lets the request through; the bearer token is the only credential.
 */
export const POST = withAxiom(async (request: NextRequest) => {
  const grant = await resolveMcpGrant(request)
  if (!grant.ok) return mcpUnauthorized(request, BETTER_AUTH_URL)

  const byUser = await consume(mcpUserLimiter, `mcp:${grant.value.userId}`)
  if (!byUser.ok) return handleError(byUser.error)
  const byClient = await consume(
    mcpClientLimiter,
    `mcp-client:${grant.value.clientId}`,
  )
  if (!byClient.ok) return handleError(byClient.error)

  const access = await resolveToolAccess(
    grant.value.userId,
    grant.value.workspaceId,
  )
  if (!access.ok) {
    // Removed from the workspace (or the workspace is gone) since the
    // token was issued: the grant no longer holds.
    if (isStaleGrantError(access.error)) {
      return mcpUnauthorized(request, BETTER_AUTH_URL)
    }
    return handleError(access.error)
  }

  return handleMcpRequest(request, grant.value, access.value)
})

export const GET = withAxiom(async () => mcpMethodNotAllowed())

export const DELETE = withAxiom(async () => mcpMethodNotAllowed())
