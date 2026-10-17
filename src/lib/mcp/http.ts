import type { AppError } from '@/src/errors/app-error'
import { ERROR_CODES } from '@/src/errors/codes'

/**
 * HTTP edges of `/api/mcp` that are not JSON-RPC: the bearer challenge of
 * the MCP authorization spec and the 405 of the methods a stateless server
 * doesn't serve.
 */

export const PROTECTED_RESOURCE_METADATA_PATH =
  '/.well-known/oauth-protected-resource'

/** `WWW-Authenticate` value pointing clients at the resource metadata. */
export function mcpBearerChallenge(origin: string, hasToken: boolean): string {
  const base = new URL(origin).origin
  const metadata = `resource_metadata="${base}${PROTECTED_RESOURCE_METADATA_PATH}"`
  return hasToken
    ? `Bearer error="invalid_token", ${metadata}`
    : `Bearer ${metadata}`
}

function hasBearer(request: Request): boolean {
  const header = request.headers.get('authorization') ?? ''
  return /^bearer\s+\S+/i.test(header)
}

/** 401 that MCP clients follow into the OAuth flow. */
export function mcpUnauthorized(request: Request, origin: string): Response {
  return Response.json(
    {
      success: false,
      statusCode: 401,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Token de integração inválido ou ausente',
      },
    },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': mcpBearerChallenge(origin, hasBearer(request)),
      },
    },
  )
}

/** Stateless server: no SSE stream to open (GET) nor session to end (DELETE). */
export function mcpMethodNotAllowed(): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    },
    { status: 405, headers: { Allow: 'POST' } },
  )
}

/** Whether a failed access check means the grant no longer holds (→ 401). */
export function isStaleGrantError(error: AppError): boolean {
  const { status } = ERROR_CODES[error.code]
  return status === 401 || status === 403 || status === 404
}
