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
