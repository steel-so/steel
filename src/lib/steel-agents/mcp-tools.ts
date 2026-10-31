/**
 * Naming of the external MCP tools an agent may call (A8). A tool of server
 * `slack` named `post.message` becomes `mcp_slack__post_message`: snake_case,
 * ≤ 64 chars, so it passes the agent tool schema and every model provider.
 */

export const MCP_TOOL_PREFIX = 'mcp_'
export const MCP_SLUG_MAX = 16
export const MCP_TOOL_NAME_MAX = 64
/** Servers a workspace may register. */
export const MAX_MCP_SERVERS = 10
/** Tools kept from one discovery. */
export const MAX_MCP_TOOLS_PER_SERVER = 100

export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX) && name.includes('__')
}

/** Lower-case letters/digits only, starting with a letter. */
export function mcpSlugFrom(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, MCP_SLUG_MAX)
  if (!base) return 'mcp'
  return /^[a-z]/.test(base) ? base : `s${base}`.slice(0, MCP_SLUG_MAX)
}

function sanitizeToolPart(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Name the model sees for `remoteName` on the server `slug`. */
export function mcpToolName(slug: string, remoteName: string): string {
  const head = `${MCP_TOOL_PREFIX}${slug}__`
  const part = sanitizeToolPart(remoteName) || 'tool'
  return `${head}${part}`.slice(0, MCP_TOOL_NAME_MAX)
}

/** Server slug of an MCP tool name (null when it is not one). */
export function mcpSlugOf(toolName: string): string | null {
  if (!isMcpToolName(toolName)) return null
  return toolName.slice(MCP_TOOL_PREFIX.length, toolName.indexOf('__'))
}

/** A tool as discovered on the server (what `toolsCache` holds). */
export interface McpRemoteTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** MCP `readOnlyHint`: the tool only reads. */
  readOnly: boolean
}

/** Parses the stored cache; garbled entries are dropped. */
export function parseToolsCache(value: unknown): McpRemoteTool[] {
  if (!Array.isArray(value)) return []
  const tools: McpRemoteTool[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    if (typeof raw.name !== 'string' || raw.name === '') continue
    tools.push({
      name: raw.name,
      description: typeof raw.description === 'string' ? raw.description : '',
      inputSchema:
        raw.inputSchema && typeof raw.inputSchema === 'object'
          ? (raw.inputSchema as Record<string, unknown>)
          : { type: 'object', properties: {} },
      readOnly: raw.readOnly === true,
    })
  }
  return tools
}
