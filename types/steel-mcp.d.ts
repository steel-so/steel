/**
 * Contract of the external MCP servers Steel Agents may call
 * (`/api/workspaces/:id/agents/mcp-servers/**`, A8). The auth header value is
 * write-only: it is never returned.
 */

export interface SteelMcpToolDTO {
  /** Name on the remote server. */
  name: string
  /** Name the model sees (`mcp_<slug>__<tool>`). */
  agentToolName: string
  description: string
  /** MCP `readOnlyHint`: only reads. Everything else is a write. */
  readOnly: boolean
  /** Whether it is on the allow-list. */
  allowed: boolean
}

export interface SteelMcpServerDTO {
  id: string
  name: string
  slug: string
  url: string
  authHeaderName: string
  /** A secret is stored (the value itself is never returned). */
  hasAuth: boolean
  enabled: boolean
  tools: SteelMcpToolDTO[]
  discoveredAt: string | null
  lastError: string | null
  createdAt: string
}
