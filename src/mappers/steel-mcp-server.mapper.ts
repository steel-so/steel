import type { SteelMcpServer } from '@prisma/client'
import { mcpToolName, parseToolsCache } from '@/src/lib/steel-agents/mcp-tools'
import type { SteelMcpServerDTO } from '@/types/steel-mcp'

export function toSteelMcpServerDTO(server: SteelMcpServer): SteelMcpServerDTO {
  return {
    id: server.id,
    name: server.name,
    slug: server.slug,
    url: server.url,
    authHeaderName: server.authHeaderName,
    hasAuth: Boolean(server.encryptedAuthValue),
    enabled: server.enabled,
    tools: parseToolsCache(server.toolsCache).map((tool) => ({
      name: tool.name,
      agentToolName: mcpToolName(server.slug, tool.name),
      description: tool.description,
      readOnly: tool.readOnly,
      allowed: server.allowedTools.includes(tool.name),
    })),
    discoveredAt: server.discoveredAt?.toISOString() ?? null,
    lastError: server.lastError,
    createdAt: server.createdAt.toISOString(),
  }
}
