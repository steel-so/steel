import { MCP_SCOPES, type McpScope } from '@/src/lib/mcp/grant'
import type {
  IntegrationGrantWithRelations,
  WorkspaceIntegrationGrantRow,
} from '@/src/repositories/integration-grant.repository'
import type {
  IntegrationGrantDTO,
  McpUsageDTO,
  WorkspaceIntegrationClientDTO,
  WorkspaceIntegrationGrantDTO,
} from '@/types/integration-grant'

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
    redirectHost: grant.redirectHost,
    scopes: toMcpScopes(grant.scopes),
    modules: grant.modules,
    lastUsedAt: grant.lastUsedAt ? grant.lastUsedAt.toISOString() : null,
    createdAt: grant.createdAt.toISOString(),
  }
}

const NO_USAGE: McpUsageDTO = { last7Days: 0, last30Days: 0 }

function usageOf(
  usage: ReadonlyMap<string, McpUsageDTO>,
  id: string,
): McpUsageDTO {
  const counts = usage.get(id)
  return counts
    ? { last7Days: counts.last7Days, last30Days: counts.last30Days }
    : { ...NO_USAGE }
}

export function toWorkspaceIntegrationGrantDTO(
  grant: WorkspaceIntegrationGrantRow,
  usageByGrant: ReadonlyMap<string, McpUsageDTO>,
): WorkspaceIntegrationGrantDTO {
  return {
    id: grant.id,
    user: {
      id: grant.user.id,
      name: grant.user.name,
      email: grant.user.email,
      image: grant.user.image,
    },
    client: {
      clientId: grant.client.clientId,
      name: grant.client.name,
      icon: grant.client.icon,
      uri: grant.client.uri,
    },
    redirectHost: grant.redirectHost,
    scopes: toMcpScopes(grant.scopes),
    modules: grant.modules,
    lastUsedAt: grant.lastUsedAt ? grant.lastUsedAt.toISOString() : null,
    createdAt: grant.createdAt.toISOString(),
    usage: usageOf(usageByGrant, grant.id),
  }
}

/**
 * One entry per app with active grants, in the order the apps first appear
 * in `grants` (most recent grant first). Usage comes from the per-app
 * counters, so calls of grants revoked since then still count.
 */
export function toWorkspaceIntegrationClientDTOs(
  grants: readonly WorkspaceIntegrationGrantRow[],
  usageByClient: ReadonlyMap<string, McpUsageDTO>,
): WorkspaceIntegrationClientDTO[] {
  const byClient = new Map<
    string,
    { dto: WorkspaceIntegrationClientDTO; users: Set<string> }
  >()
  for (const grant of grants) {
    let entry = byClient.get(grant.clientId)
    if (!entry) {
      entry = {
        dto: {
          client: {
            clientId: grant.client.clientId,
            name: grant.client.name,
            icon: grant.client.icon,
            uri: grant.client.uri,
          },
          redirectHost: grant.redirectHost,
          members: 0,
          canWrite: false,
          lastUsedAt: null,
          usage: usageOf(usageByClient, grant.clientId),
        },
        users: new Set(),
      }
      byClient.set(grant.clientId, entry)
    }
    entry.users.add(grant.userId)
    entry.dto.members = entry.users.size
    if (grant.scopes.includes('mcp:write')) entry.dto.canWrite = true
    const used = grant.lastUsedAt?.toISOString() ?? null
    if (used && (!entry.dto.lastUsedAt || used > entry.dto.lastUsedAt)) {
      entry.dto.lastUsedAt = used
    }
  }
  return [...byClient.values()].map((entry) => entry.dto)
}
