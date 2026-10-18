/**
 * Adjustments to the Authorization Server Metadata (RFC 8414) the
 * oauth-provider plugin generates (ADR 0033).
 *
 * The plugin hard-codes `revocation_endpoint_auth_methods_supported` to the
 * two secret-based methods, although its revoke endpoint accepts a public
 * client with only `client_id` — which is how every dynamically registered
 * client (`token_endpoint_auth_method: none`) revokes. Advertising `none`
 * tells clients such as `steel mcp logout` they may revoke too.
 */

/** Path where Better Auth itself answers the metadata (issuer + well-known). */
export const ISSUER_METADATA_PATH =
  '/api/auth/.well-known/oauth-authorization-server'

const REVOCATION_METHODS = 'revocation_endpoint_auth_methods_supported'

export function advertisePublicRevocation(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const current = metadata[REVOCATION_METHODS]
  const methods = Array.isArray(current)
    ? current.filter((m): m is string => typeof m === 'string')
    : []
  if (methods.includes('none')) return metadata
  return { ...metadata, [REVOCATION_METHODS]: ['none', ...methods] }
}

/**
 * The same metadata response with `none` added. Anything that is not a
 * successful JSON object is passed through untouched.
 */
export async function patchAuthServerMetadataResponse(
  response: Response,
): Promise<Response> {
  if (!response.ok) return response
  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    return response
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return response
  }
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(
    JSON.stringify(advertisePublicRevocation(body as Record<string, unknown>)),
    { status: response.status, headers },
  )
}
