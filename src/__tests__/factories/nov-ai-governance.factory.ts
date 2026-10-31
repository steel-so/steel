import { createId } from '@paralleldrive/cuid2'
import type { SteelAgentPolicy, SteelMcpServer } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

const NOW = new Date('2026-10-30T12:00:00.000Z')

export function createFakeSteelAgentPolicy(
  overrides?: Partial<SteelAgentPolicy>,
): SteelAgentPolicy {
  return {
    id: createId(),
    workspaceId: createId(),
    killedAt: null,
    killedById: null,
    killReason: null,
    restrictCreators: false,
    creatorRoles: [],
    restrictAuto: false,
    autoRules: null,
    updatedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeSteelMcpServer(
  overrides?: Partial<SteelMcpServer>,
): SteelMcpServer {
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'GitHub',
    slug: 'github',
    url: 'https://mcp.example.com/mcp',
    authHeaderName: 'Authorization',
    encryptedAuthValue: null,
    enabled: true,
    allowedTools: [],
    toolsCache: [
      {
        name: 'list_issues',
        description: 'Lista issues',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
      },
      {
        name: 'create_issue',
        description: 'Abre uma issue',
        inputSchema: {
          type: 'object',
          properties: { title: { type: 'string' } },
        },
        readOnly: false,
      },
    ],
    discoveredAt: NOW,
    lastError: null,
    createdById: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** Persists an MCP server (integration tests). */
export async function createSteelMcpServer(
  workspaceId: string,
  overrides?: Partial<SteelMcpServer>,
): Promise<SteelMcpServer> {
  const {
    id: _id,
    createdAt: _c,
    updatedAt: _u,
    ...data
  } = createFakeSteelMcpServer({ workspaceId, ...overrides })
  return prisma.steelMcpServer.create({
    data: { ...data, toolsCache: data.toolsCache ?? undefined } as never,
  })
}
