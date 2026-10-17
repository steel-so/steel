import { withAxiom } from '@/lib/axiom/server'
import {
  METADATA_CORS_HEADERS,
  protectedResourceMetadata,
} from '@/src/lib/mcp/oauth-config'

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) of the MCP endpoint. The
 * MCP server's 401 points here (`WWW-Authenticate: Bearer
 * resource_metadata=…`); RFC 9728 clients may also ask the path-suffixed
 * form (`/.well-known/oauth-protected-resource/api/mcp`), which the optional
 * catch-all answers with the same document.
 */
export const GET = withAxiom(async () =>
  Response.json(protectedResourceMetadata(), {
    headers: {
      ...METADATA_CORS_HEADERS,
      'Cache-Control': 'public, max-age=300',
    },
  }),
)

export function OPTIONS() {
  return new Response(null, { status: 204, headers: METADATA_CORS_HEADERS })
}
