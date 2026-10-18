import type { McpScope } from '@/src/lib/mcp/grant'

export type IntegrationModuleDTO = 'SERVICE_DESK' | 'CRM' | 'COMMUNICATION'

/** One row of "Apps conectados": an active grant of the signed-in user. */
export interface IntegrationGrantDTO {
  id: string
  client: {
    clientId: string
    name: string | null
    icon: string | null
    uri: string | null
  }
  workspace: { id: string; name: string; slug: string }
  scopes: McpScope[]
  modules: IntegrationModuleDTO[]
  lastUsedAt: string | null
  createdAt: string
}

/** What the consent page needs to render. */
export interface OAuthConsentContextDTO {
  client: {
    clientId: string
    name: string | null
    icon: string | null
    uri: string | null
  }
  /** Scopes the client asked for, restricted to the MCP ones. */
  requestedScopes: McpScope[]
  workspaces: {
    id: string
    name: string
    slug: string
    /** Enabled modules the user may grant in this workspace. */
    modules: IntegrationModuleDTO[]
  }[]
}

export interface OAuthConsentResultDTO {
  /** Where the browser goes next: the client's `redirect_uri`. */
  redirectUrl: string
}

/** MCP tool calls in the last 7 and 30 days (today included). */
export interface McpUsageDTO {
  last7Days: number
  last30Days: number
}

/** One row of the workspace "Apps conectados": a member's active grant. */
export interface WorkspaceIntegrationGrantDTO {
  id: string
  user: { id: string; name: string; email: string; image: string | null }
  client: IntegrationGrantDTO['client']
  scopes: McpScope[]
  modules: IntegrationModuleDTO[]
  lastUsedAt: string | null
  createdAt: string
  usage: McpUsageDTO
}

/** An app (OAuth client) with active grants in the workspace. */
export interface WorkspaceIntegrationClientDTO {
  client: IntegrationGrantDTO['client']
  /** Members holding an active grant for this app. */
  members: number
  /** Whether some active grant of this app has `mcp:write`. */
  canWrite: boolean
  lastUsedAt: string | null
  /** Calls of every grant of the app, revoked ones included. */
  usage: McpUsageDTO
}

/** `GET /api/workspaces/{id}/integration-grants`. */
export interface WorkspaceIntegrationGrantsDTO {
  grants: WorkspaceIntegrationGrantDTO[]
  clients: WorkspaceIntegrationClientDTO[]
}

/** Answer of a bulk revocation (one member's or one app's grants). */
export interface IntegrationGrantRevokeManyDTO {
  revoked: number
}
