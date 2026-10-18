import { describe, expect, it, vi } from 'vitest'
import { createFakeWorkspaceAiSettings } from '@/src/__tests__/factories/ai-settings.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeAiPendingAction } from '@/src/__tests__/factories/steel-ai.factory'
import { createFakeWorkspaceModuleAccess } from '@/src/__tests__/factories/workspace-module-access.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { validationError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/repositories/ai-pending-action.repository')

import { AiPendingActionRepository } from '@/src/repositories/ai-pending-action.repository'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { STEEL_AI_TOOLS } from '../ai/tools'
import {
  type AiToolAccess,
  aiActionSource,
  assertValidToolRegistry,
  availableTools,
  findTool,
  hasToolAccess,
  isWriteMode,
  PENDING_ACTION_TTL_MS,
  proposeWriteTool,
  resolveToolAccess,
  runReadTool,
  runTool,
  toolMeta,
  toToolSpecs,
  validateToolRegistry,
} from '../ai/tools/registry'
import type { AnySteelAiTool } from '../ai/tools/types'

const ctx = { workspaceId: 'ws1', actorId: 'u1', source: 'assistant' as const }

function tool(overrides: Partial<AnySteelAiTool>): AnySteelAiTool {
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

const read = tool({ name: 'sd_list', module: 'SERVICE_DESK' })
const crmRead = tool({
  name: 'crm_list',
  module: 'CRM',
  permission: { resource: 'leads', action: 'VIEW' },
})
const write = tool({
  name: 'sd_create',
  module: 'SERVICE_DESK',
  kind: 'CREATE',
  preview: vi.fn(async () => ok({ title: 'Criar', summary: 's' })),
})
const remove = tool({
  name: 'sd_delete',
  module: 'SERVICE_DESK',
  kind: 'DELETE',
  permission: { resource: 'sd-tickets', action: 'DELETE' },
  preview: vi.fn(async () => ok({ title: 'Excluir', summary: 's' })),
})
const TOOLS = [read, crmRead, write, remove]

const access = (overrides: Partial<AiToolAccess> = {}): AiToolAccess => ({
  modules: ['SERVICE_DESK', 'CRM'],
  isPrivileged: false,
  permissions: { leads: ['VIEW'], 'sd-tickets': ['VIEW', 'CREATE'] },
  agentModeEnabled: true,
  aiEnabled: true,
  agentsEnabled: true,
  autopilotEnabled: false,
  ...overrides,
})

const names = (tools: AnySteelAiTool[]) => tools.map((t) => t.name)

describe('tool registry validation', () => {
  it('should accept every registered Steel AI tool', () => {
    expect(validateToolRegistry(STEEL_AI_TOOLS)).toEqual([])
    expect(() => assertValidToolRegistry(STEEL_AI_TOOLS)).not.toThrow()
  })

  it('should report duplicates, bad names, missing previews and schemas', () => {
    const problems = validateToolRegistry([
      read,
      read,
      tool({ name: 'Bad-Name' }),
      tool({
        name: 'w_tool',
        kind: 'UPDATE',
        annotations: { destructiveHint: true },
      }),
      tool({ name: 'p_tool', parameters: { type: 'string' } }),
    ])
    expect(problems).toEqual([
      'Duplicate tool name "sd_list"',
      'Tool "Bad-Name" must be snake_case (≤ 64 chars)',
      'Write tool "w_tool" must implement preview()',
      'Tool "p_tool" parameters must be an object schema',
    ])
    expect(() => assertValidToolRegistry([read, read])).toThrow(
      'Invalid Steel AI tool registry',
    )
  })
})

describe('tool registry validation: MCP hints', () => {
  const preview = vi.fn(async () => ok({ title: 't', summary: 's' }))
  const writeTool = (overrides: Partial<AnySteelAiTool>) =>
    tool({ kind: 'UPDATE', preview, ...overrides })

  it('should accept consistent hints on reads and writes', () => {
    expect(
      validateToolRegistry([
        tool({ name: 'r_plain' }),
        tool({ name: 'r_hint', annotations: { destructiveHint: false } }),
        writeTool({
          name: 'u_tool',
          annotations: { idempotentHint: true, destructiveHint: true },
        }),
        writeTool({
          name: 'c_tool',
          kind: 'CREATE',
          annotations: { destructiveHint: false },
        }),
        writeTool({
          name: 'd_tool',
          kind: 'DELETE',
          annotations: { destructiveHint: true },
        }),
        writeTool({
          name: 'a_send',
          kind: 'ACTION',
          annotations: { destructiveHint: false, openWorldHint: true },
          customerFacing: true,
        }),
      ]),
    ).toEqual([])
  })

  it('should refuse destructive or customer-facing read tools', () => {
    expect(
      validateToolRegistry([
        tool({ name: 'r_destroy', annotations: { destructiveHint: true } }),
        tool({ name: 'r_customer', customerFacing: true }),
      ]),
    ).toEqual([
      'Read tool "r_destroy" cannot be destructive',
      'Read tool "r_customer" cannot be customer-facing',
    ])
  })

  it('should require destructiveHint on every write tool', () => {
    expect(
      validateToolRegistry([
        writeTool({ name: 'u_none' }),
        writeTool({ name: 'u_partial', annotations: { idempotentHint: true } }),
      ]),
    ).toEqual([
      'Write tool "u_none" must declare destructiveHint',
      'Write tool "u_partial" must declare destructiveHint',
    ])
  })

  it('should keep DELETE destructive and CREATE additive', () => {
    expect(
      validateToolRegistry([
        writeTool({
          name: 'd_soft',
          kind: 'DELETE',
          annotations: { destructiveHint: false },
        }),
        writeTool({
          name: 'c_hard',
          kind: 'CREATE',
          annotations: { destructiveHint: true },
        }),
      ]),
    ).toEqual([
      'Delete tool "d_soft" must be destructive',
      'Create tool "c_hard" must not be destructive',
    ])
  })

  it('should require openWorldHint on customer-facing tools', () => {
    expect(
      validateToolRegistry([
        writeTool({
          name: 'a_silent',
          kind: 'ACTION',
          annotations: { destructiveHint: false },
          customerFacing: true,
        }),
        writeTool({
          name: 'a_closed',
          kind: 'ACTION',
          annotations: { destructiveHint: false, openWorldHint: false },
          customerFacing: true,
        }),
      ]),
    ).toEqual([
      'Customer-facing tool "a_silent" must declare openWorldHint',
      'Customer-facing tool "a_closed" must declare openWorldHint',
    ])
  })

  it('should refuse empty and long labels', () => {
    expect(
      validateToolRegistry([
        tool({ name: 'l_empty', label: '  ' }),
        tool({ name: 'l_long', label: 'x'.repeat(41) }),
        tool({ name: 'l_edge', label: 'x'.repeat(40) }),
      ]),
    ).toEqual([
      'Tool "l_empty" label must have 1–40 chars',
      'Tool "l_long" label must have 1–40 chars',
    ])
  })

  it('should annotate every registered tool consistently', () => {
    for (const t of STEEL_AI_TOOLS) {
      if (t.kind === 'READ') {
        expect(t.customerFacing, t.name).not.toBe(true)
      } else {
        expect(typeof t.annotations?.destructiveHint, t.name).toBe('boolean')
      }
    }
    const customerFacing = STEEL_AI_TOOLS.filter((t) => t.customerFacing)
      .map((t) => t.name)
      .sort()
    expect(customerFacing).toEqual([
      'sd_cancel_ticket',
      'sd_move_ticket_phase',
      'sd_reply_to_requester',
      'sd_request_approval',
      'zap_message_send_text',
    ])
  })
})

describe('availableTools()', () => {
  it('should only offer READ tools in EXPLORE', () => {
    expect(names(availableTools(access(), 'EXPLORE', TOOLS))).toEqual([
      'sd_list',
      'crm_list',
    ])
  })

  it('should add the write tools the profile allows in AGENT', () => {
    expect(names(availableTools(access(), 'AGENT', TOOLS))).toEqual([
      'sd_list',
      'crm_list',
      'sd_create',
    ])
  })

  it('should hide writes when the workspace switched agent mode off', () => {
    expect(
      names(
        availableTools(access({ agentModeEnabled: false }), 'AGENT', TOOLS),
      ),
    ).toEqual(['sd_list', 'crm_list'])
  })

  it('should hide tools of disabled modules', () => {
    expect(
      names(availableTools(access({ modules: ['CRM'] }), 'AGENT', TOOLS)),
    ).toEqual(['crm_list'])
  })

  it('should deny by default without a permission map, unless privileged', () => {
    expect(
      names(availableTools(access({ permissions: null }), 'AGENT', TOOLS)),
    ).toEqual(['sd_list', 'sd_create'])
    expect(
      names(
        availableTools(
          access({ permissions: null, isPrivileged: true }),
          'AGENT',
          TOOLS,
        ),
      ),
    ).toEqual(['sd_list', 'crm_list', 'sd_create', 'sd_delete'])
  })

  it('should default to the registered tools', () => {
    expect(availableTools(access({ isPrivileged: true }), 'AGENT')).toEqual(
      STEEL_AI_TOOLS.filter((t) => !t.module || t.module !== 'COMMUNICATION'),
    )
  })
})

describe('findTool() / toolMeta() / toToolSpecs()', () => {
  it('should find tools and describe unknown ones by name', () => {
    expect(findTool('sd_list', TOOLS)).toBe(read)
    expect(findTool('nope', TOOLS)).toBeUndefined()
    expect(findTool('ws_overview')?.kind).toBe('READ')
    expect(toolMeta('sd_list', TOOLS)).toEqual({
      label: 'Ferramenta',
      module: 'SERVICE_DESK',
    })
    expect(toolMeta('nope', TOOLS)).toEqual({ label: 'nope', module: null })
    expect(toolMeta('ws_members').label).toBe('Consultando membros')
    expect(toToolSpecs([read])).toEqual([
      { name: 'sd_list', description: 'd', parameters: read.parameters },
    ])
  })
})

describe('resolveToolAccess()', () => {
  const memberships = vi.mocked(MembershipRepository)
  const settings = vi.mocked(WorkspaceAiSettingsRepository)
  const modules = vi.mocked(WorkspaceModuleAccessRepository)

  it('should combine membership, enabled modules and the agent switch', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'ADMIN' })),
    )
    modules.listByWorkspace.mockResolvedValue(
      ok([
        createFakeWorkspaceModuleAccess({ module: 'CRM', enabled: true }),
        createFakeWorkspaceModuleAccess({
          module: 'SERVICE_DESK',
          enabled: false,
        }),
      ]),
    )
    settings.findByWorkspace.mockResolvedValue(
      ok(createFakeWorkspaceAiSettings({ agentModeEnabled: false })),
    )
    expect(expectOk(await resolveToolAccess('u1', 'ws1'))).toEqual(
      expect.objectContaining({
        modules: ['CRM'],
        isPrivileged: true,
        agentModeEnabled: false,
      }),
    )

    settings.findByWorkspace.mockResolvedValue(ok(null))
    expect(
      expectOk(await resolveToolAccess('u1', 'ws1')).agentModeEnabled,
    ).toBe(true)
  })

  it('should propagate membership, module and settings failures', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await resolveToolAccess('u1', 'ws1'), 'FORBIDDEN')

    memberships.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership()),
    )
    modules.listByWorkspace.mockResolvedValue(err(databaseError()))
    settings.findByWorkspace.mockResolvedValue(ok(null))
    expectErr(await resolveToolAccess('u1', 'ws1'), 'DATABASE_ERROR')

    modules.listByWorkspace.mockResolvedValue(ok([]))
    settings.findByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await resolveToolAccess('u1', 'ws1'), 'DATABASE_ERROR')
  })
})

describe('runTool() / runReadTool()', () => {
  it('should execute and serialize the payload', async () => {
    const run = await runReadTool(read, ctx, { q: 1 })
    expect(run.ok).toBe(true)
    expect(JSON.parse(run.content)).toEqual({
      status: 'done',
      summary: 'ok',
      data: { a: 1 },
    })
    expect(read.execute).toHaveBeenCalledWith(ctx, { q: 1 })
  })

  it('should turn parse, execution and thrown errors into error payloads', async () => {
    const invalid = await runTool(
      tool({ parse: () => err(validationError('Campo x inválido')) }),
      ctx,
      {},
    )
    expect(invalid.ok).toBe(false)
    expect(JSON.parse(invalid.content).error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Campo x inválido',
    })

    const denied = await runTool(
      tool({ execute: async () => err(forbidden()) }),
      ctx,
      {},
    )
    expect(denied.ok ? null : denied.error.code).toBe('FORBIDDEN')

    const thrown = await runTool(
      tool({
        execute: async () => {
          throw new Error('boom')
        },
      }),
      ctx,
      {},
    )
    expect(thrown.ok ? null : thrown.error.code).toBe('INTERNAL_SERVER_ERROR')

    const nonError = await runTool(
      tool({
        execute: async () => {
          throw 'string'
        },
      }),
      ctx,
      {},
    )
    expect(nonError.ok).toBe(false)
  })

  it('should refuse to run a write tool as a read', async () => {
    const run = await runReadTool(write, ctx, {})
    expect(run.ok ? null : run.error.code).toBe('AI_TOOL_NOT_ALLOWED')
    expect(write.execute).not.toHaveBeenCalled()
  })
})

describe('proposeWriteTool()', () => {
  const repo = vi.mocked(AiPendingActionRepository)
  const now = new Date('2026-10-06T12:00:00.000Z')

  it('should store a PENDING action with preview and 30 min expiry', async () => {
    repo.create.mockResolvedValue(ok(createFakeAiPendingAction()))
    expectOk(
      await proposeWriteTool(
        write,
        ctx,
        { title: 'x' },
        { conversationId: 'c1', toolCallId: 'call1' },
        now,
      ),
    )
    expect(repo.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      requestedById: 'u1',
      conversationId: 'c1',
      agentRunId: null,
      toolName: 'sd_create',
      toolCallId: 'call1',
      kind: 'CREATE',
      module: 'SERVICE_DESK',
      args: { title: 'x' },
      preview: { title: 'Criar', summary: 's' },
      requiresDoubleConfirm: false,
      expiresAt: new Date(now.getTime() + PENDING_ACTION_TTL_MS),
    })
    expect(write.execute).not.toHaveBeenCalled()
  })

  it('should require the double confirmation for deletes and keep agent runs unowned', async () => {
    repo.create.mockResolvedValue(ok(createFakeAiPendingAction()))
    await proposeWriteTool(
      remove,
      { ...ctx, source: 'agent', agentId: 'ag1' },
      {},
      { agentRunId: 'run1' },
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedById: null,
        conversationId: null,
        toolCallId: null,
        agentRunId: 'run1',
        requiresDoubleConfirm: true,
      }),
    )
  })

  it('should refuse read tools and stop on parse/preview errors', async () => {
    expectErr(await proposeWriteTool(read, ctx, {}), 'AI_TOOL_NOT_ALLOWED')
    expectErr(
      await proposeWriteTool(tool({ ...write, preview: undefined }), ctx, {}),
      'AI_TOOL_NOT_ALLOWED',
    )
    expectErr(
      await proposeWriteTool(
        { ...write, parse: () => err(validationError('x')) },
        ctx,
        {},
      ),
      'VALIDATION_ERROR',
    )
    expectErr(
      await proposeWriteTool(
        { ...write, preview: async () => err(forbidden()) },
        ctx,
        {},
      ),
      'FORBIDDEN',
    )
    expectErr(
      await proposeWriteTool(
        {
          ...write,
          preview: async () => {
            throw new Error('boom')
          },
        },
        ctx,
        {},
      ),
      'INTERNAL_SERVER_ERROR',
    )
    expect(repo.create).not.toHaveBeenCalled()
  })
})

describe('Steel AI 2 — AUTOPILOT and workspace switches', () => {
  it('should offer writes in AUTOPILOT only when the workspace enabled it', () => {
    expect(
      availableTools(access(), 'AUTOPILOT', TOOLS).some(
        (t) => t.kind !== 'READ',
      ),
    ).toBe(false)
    expect(
      availableTools(access({ autopilotEnabled: true }), 'AUTOPILOT', TOOLS)
        .map((t) => t.kind)
        .some((kind) => kind !== 'READ'),
    ).toBe(true)
    expect(
      availableTools(
        access({ autopilotEnabled: true, agentModeEnabled: false }),
        'AUTOPILOT',
        TOOLS,
      ).every((t) => t.kind === 'READ'),
    ).toBe(true)
  })

  it('isWriteMode() should cover AGENT and AUTOPILOT', () => {
    expect(isWriteMode('EXPLORE')).toBe(false)
    expect(isWriteMode('AGENT')).toBe(true)
    expect(isWriteMode('AUTOPILOT')).toBe(true)
  })

  it('resolveToolAccess() should expose the switches with their defaults', async () => {
    const memberships = vi.mocked(MembershipRepository)
    const settings = vi.mocked(WorkspaceAiSettingsRepository)
    const modules = vi.mocked(WorkspaceModuleAccessRepository)
    memberships.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'OWNER' })),
    )
    modules.listByWorkspace.mockResolvedValue(ok([]))
    settings.findByWorkspace.mockResolvedValue(ok(null))
    expect(expectOk(await resolveToolAccess('u1', 'ws1'))).toEqual(
      expect.objectContaining({
        aiEnabled: true,
        agentsEnabled: true,
        autopilotEnabled: false,
        mcpWriteEnabled: false,
      }),
    )
    settings.findByWorkspace.mockResolvedValue(
      ok(
        createFakeWorkspaceAiSettings({
          aiEnabled: false,
          agentsEnabled: false,
          autopilotEnabled: true,
          mcpWriteEnabled: true,
        }),
      ),
    )
    expect(expectOk(await resolveToolAccess('u1', 'ws1'))).toEqual(
      expect.objectContaining({
        aiEnabled: false,
        agentsEnabled: false,
        autopilotEnabled: true,
        mcpWriteEnabled: true,
      }),
    )
  })
})

describe('MCP governance helpers', () => {
  it('aiActionSource() should map each context source', () => {
    expect(aiActionSource({ source: 'assistant' })).toBe('ASSISTANT')
    expect(aiActionSource({ source: 'agent' })).toBe('AGENT')
    expect(aiActionSource({ source: 'mcp' })).toBe('MCP')
  })

  it('hasToolAccess() should check module and RBAC, not the mode switches', () => {
    const off = access({ agentModeEnabled: false, autopilotEnabled: false })
    expect(hasToolAccess(write, off)).toBe(true)
    expect(hasToolAccess(write, access({ modules: ['CRM'] }))).toBe(false)
    expect(hasToolAccess(crmRead, access({ permissions: null }))).toBe(false)
  })

  it('proposeWriteTool() should own MCP proposals by the user and keep the grant', async () => {
    const repo = vi.mocked(AiPendingActionRepository)
    repo.create.mockResolvedValue(ok(createFakeAiPendingAction()))
    await proposeWriteTool(
      write,
      { ...ctx, source: 'mcp', oauthClientId: 'client1' },
      {},
      { integrationGrantId: 'g1' },
    )
    expect(repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestedById: 'u1',
        conversationId: null,
        integrationGrantId: 'g1',
      }),
    )
  })
})
