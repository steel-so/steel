import { MCP_SCOPES, type McpScope } from '@/src/lib/mcp/grant'
import type { IntegrationGrantWithRelations } from '@/src/repositories/integration-grant.repository'
import type { IntegrationGrantDTO } from '@/types/integration-grant'

/** Keeps only the MCP scopes, in canonical order (`offline_access` is plumbing). */
export function toMcpScopes(scopes: readonly string[]): McpScope[] {
  return MCP_SCOPES.filter((scope) => scopes.includes(scope))
}

export function toIntegrationGrantDTO(
  grant: IntegrationGrantWithRelations,
): IntegrationGrantDTO {
  return {
    id: grant.id,
    client: {
      clientId: grant.client.clientId,
      name: grant.client.name,
      icon: grant.client.icon,
      uri: grant.client.uri,
    },
    workspace: {
      id: grant.workspace.id,
      name: grant.workspace.name,
      slug: grant.workspace.slug,
    },
    scopes: toMcpScopes(grant.scopes),
    modules: grant.modules,
    lastUsedAt: grant.lastUsedAt ? grant.lastUsedAt.toISOString() : null,
    createdAt: grant.createdAt.toISOString(),
  }
}
