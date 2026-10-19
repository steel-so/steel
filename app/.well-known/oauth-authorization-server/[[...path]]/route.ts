import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'
import { withAxiom } from '@/lib/axiom/server'
import { auth } from '@/src/lib/auth'
import { patchAuthServerMetadataResponse } from '@/src/lib/mcp/auth-server-metadata'
import { METADATA_CORS_HEADERS } from '@/src/lib/mcp/oauth-config'

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414) of the Steel provider
 * (ADR 0033). The issuer is `<app>/api/auth`, so RFC 8414 clients look for
 * `/.well-known/oauth-authorization-server/api/auth`; older MCP clients ask
 * the bare path. The optional catch-all answers both with the same document,
 * which also advertises public-client revocation (`none`).
 */
const metadata = oauthProviderAuthServerMetadata(auth, {
  headers: METADATA_CORS_HEADERS,
})

export const GET = withAxiom(async (request: Request) =>
  patchAuthServerMetadataResponse(await metadata(request)),
)

export function OPTIONS() {
  return new Response(null, { status: 204, headers: METADATA_CORS_HEADERS })
}
