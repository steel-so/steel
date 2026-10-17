import { vi } from 'vitest'
import type { AiToolAccess } from '@/src/lib/ai/tools/registry'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'
import type { McpGrant } from '@/src/lib/mcp/grant'
import { ok } from '@/src/lib/result'

export function mcpGrant(overrides: Partial<McpGrant> = {}): McpGrant {
  return {
    grantId: 'g1',
    userId: 'u1',
    workspaceId: 'ws1',
    clientId: 'client1',
    clientName: 'Claude',
    scopes: ['mcp:read'],
    modules: ['SERVICE_DESK', 'CRM', 'COMMUNICATION'],
    ...overrides,
  }
}

export function mcpAccess(overrides: Partial<AiToolAccess> = {}): AiToolAccess {
  return {
    modules: ['SERVICE_DESK', 'CRM', 'COMMUNICATION'],
    isPrivileged: false,
    permissions: { leads: ['VIEW'], 'sd-tickets': ['VIEW', 'CREATE'] },
    agentModeEnabled: true,
    aiEnabled: true,
    agentsEnabled: true,
    autopilotEnabled: true,
    ...overrides,
  }
}

export function fakeTool(overrides: Partial<AnySteelAiTool>): AnySteelAiTool {
  return {
    name: 'x_tool',
    label: 'Ferramenta',
    module: null,
    kind: 'READ',
    description: 'd',
    parameters: { type: 'object', properties: {} },
    parse: (args) => ok(args),
    execute: vi.fn(async () => ok({ data: { a: 1 }, summary: 'ok' })),
    ...overrides,
  }
}
