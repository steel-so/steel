import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeIntegrationGrant } from '@/src/__tests__/factories/integration-grant.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeAiActionLog,
  createFakeAiPendingAction,
} from '@/src/__tests__/factories/steel-ai.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import type { AiToolAccess } from '@/src/lib/ai/tools/registry'
import type { AiToolContext, AnySteelAiTool } from '@/src/lib/ai/tools/types'
import { err, ok } from '@/src/lib/result'

/**
 * MCP writes (mcp-governance): direct execution of non customer-facing
 * tools, proposals of customer-facing ones and the confirm gate of actions
 * an external client proposed.
 */

const tools = vi.hoisted(() => ({ list: [] as unknown[] }))

vi.mock('@/src/lib/ai/tools/registry', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/lib/ai/tools/registry')>()
  type Tools = Parameters<typeof actual.findTool>[1]
  return {
    ...actual,
    resolveToolAccess: vi.fn(),
    findTool: vi.fn((name: string) =>
      actual.findTool(name, tools.list as Tools),
    ),
  }
})
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/ai-pending-action.repository')
vi.mock('@/src/repositories/ai-action-log.repository')
vi.mock('@/src/repositories/ai-conversation.repository')
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/repositories/integration-grant.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { resolveToolAccess } from '@/src/lib/ai/tools/registry'
import { AiActionLogRepository } from '@/src/repositories/ai-action-log.repository'
import { AiMessageRepository } from '@/src/repositories/ai-conversation.repository'
import { AiPendingActionRepository } from '@/src/repositories/ai-pending-action.repository'
import { IntegrationGrantRepository } from '@/src/repositories/integration-grant.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import {
  AiPendingActionService,
  executeMcpWrite,
  mcpConfirmPath,
  proposeMcpWrite,
} from '../ai-pending-action.service'

const mockedAccess = vi.mocked(resolveToolAccess)
const repo = vi.mocked(AiPendingActionRepository)
const logs = vi.mocked(AiActionLogRepository)
const messages = vi.mocked(AiMessageRepository)
const memberships = vi.mocked(MembershipRepository)
const grants = vi.mocked(IntegrationGrantRepository)
const workspaces = vi.mocked(WorkspaceRepository)
const audit = vi.mocked(auditMutation)

const ACCESS: AiToolAccess = {
  modules: ['CRM', 'COMMUNICATION'],
  isPrivileged: false,
  permissions: {
    tasks: ['VIEW', 'CREATE'],
    conversations: ['VIEW', 'EDIT'],
  },
  // MCP writes do not depend on the in-app agent mode.
  agentModeEnabled: false,
  aiEnabled: true,
  agentsEnabled: true,
  autopilotEnabled: false,
  mcpWriteEnabled: true,
}

const execute = vi.fn()
const createTask: AnySteelAiTool = {
  name: 'crm_create_task',
  label: 'Criando tarefa',
  module: 'CRM',
  kind: 'CREATE',
  description: '',
  parameters: { type: 'object', properties: {} },
  permission: { resource: 'tasks', action: 'CREATE' },
  parse: (args) => ok(args),
  preview: vi.fn(),
  execute,
}
const sendMessage: AnySteelAiTool = {
  ...createTask,
  name: 'zap_message_send_text',
  label: 'Enviando mensagem',
  module: 'COMMUNICATION',
  kind: 'ACTION',
  customerFacing: true,
  permission: { resource: 'conversations', action: 'EDIT' },
}
const deleteTask: AnySteelAiTool = {
  ...createTask,
  name: 'crm_delete_task',
  kind: 'DELETE',
}

const NOW = new Date('2026-10-17T12:00:00.000Z')
const CTX: AiToolContext = {
  workspaceId: 'ws1',
  actorId: 'u1',
  source: 'mcp',
  oauthClientId: 'client1',
}
const GRANT = createFakeIntegrationGrant({
  id: 'g1',
  userId: 'u1',
  workspaceId: 'ws1',
  clientId: 'client1',
  scopes: ['mcp:read', 'mcp:write'],
  modules: ['CRM', 'COMMUNICATION'],
})

function mcpPending(overrides = {}) {
  return createFakeAiPendingAction({
    id: 'act1',
    workspaceId: 'ws1',
    requestedById: 'u1',
    conversationId: null,
    toolCallId: null,
    toolName: 'zap_message_send_text',
    kind: 'ACTION',
    module: 'COMMUNICATION',
    args: { text: 'Olá' },
    integrationGrantId: 'g1',
    expiresAt: new Date('2026-10-17T12:30:00.000Z'),
    ...overrides,
  })
}

function setup(action = mcpPending()) {
  mockedAccess.mockResolvedValue(ok(ACCESS))
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  repo.findById.mockResolvedValue(ok(action))
  repo.create.mockImplementation(async (data) =>
    ok(
      createFakeAiPendingAction({
        ...data,
        id: 'act1',
        conversationId: data.conversationId,
        args: data.args as never,
        preview: data.preview as never,
      }),
    ),
  )
  repo.transitionFromPending.mockImplementation(async (id, data) =>
    ok({ ...action, id, ...data }),
  )
  repo.complete.mockImplementation(async (id, data) =>
    ok({ ...action, id, ...data, result: (data.result ?? null) as never }),
  )
  logs.create.mockResolvedValue(ok(createFakeAiActionLog()))
  messages.createMany.mockResolvedValue(ok([]))
  grants.findById.mockResolvedValue(ok(GRANT))
  workspaces.findById.mockResolvedValue(
    ok(createFakeWorkspace({ id: 'ws1', slug: 'demo' })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  tools.list = [createTask, sendMessage, deleteTask]
  vi.mocked(createTask.preview as ReturnType<typeof vi.fn>).mockResolvedValue(
    ok({ title: 'Criar tarefa “Ligar”', summary: 'x' }),
  )
  execute.mockResolvedValue(
    ok({
      data: { id: 'task1' },
      summary: 'Tarefa “Ligar” criada',
      target: { type: 'crm_task', id: 'task1', label: 'Ligar' },
    }),
  )
})

describe('mcpConfirmPath()', () => {
  it('should point at the inbox AI view with the action', () => {
    expect(mcpConfirmPath('demo', 'act 1')).toBe(
      '/demo/inbox?view=ai&action=act%201',
    )
  })
})

describe('executeMcpWrite()', () => {
  it('should create a claimed action, run it and log it as MCP', async () => {
    setup()

    const done = expectOk(
      await executeMcpWrite(
        createTask,
        CTX,
        { title: 'Ligar' },
        { integrationGrantId: 'g1' },
        NOW,
      ),
    )

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedById: 'u1',
        integrationGrantId: 'g1',
        status: 'EXECUTED',
        decidedById: 'u1',
        autoExecuted: true,
      }),
    )
    expect(execute).toHaveBeenCalledWith(CTX, { title: 'Ligar' })
    expect(done.action.status).toBe('EXECUTED')
    expect(done.run.ok).toBe(true)
    expect(logs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'MCP',
        actorId: 'u1',
        oauthClientId: 'client1',
        outcome: 'success',
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'ai_pending_action',
        action: 'auto_execute',
        meta: expect.objectContaining({
          mode: 'MCP',
          source: 'mcp',
          oauthClientId: 'client1',
        }),
      }),
    )
    // No conversation: nothing is appended to a transcript.
    expect(messages.createMany).not.toHaveBeenCalled()
  })

  it('should record a failed run and propagate create/complete failures', async () => {
    setup()
    execute.mockResolvedValue(err(forbidden('Sem permissão')))
    const failed = expectOk(
      await executeMcpWrite(createTask, CTX, {}, { integrationGrantId: 'g1' }),
    )
    expect(failed.action.status).toBe('FAILED')
    expect(failed.run.ok).toBe(false)

    repo.complete.mockResolvedValue(err(databaseError()))
    expectErr(
      await executeMcpWrite(createTask, CTX, {}, { integrationGrantId: 'g1' }),
      'DATABASE_ERROR',
    )

    repo.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await executeMcpWrite(createTask, CTX, {}, { integrationGrantId: 'g1' }),
      'DATABASE_ERROR',
    )
  })
})

describe('proposeMcpWrite()', () => {
  it('should create a PENDING action for the user and return the confirm path', async () => {
    setup()
    vi.mocked(
      sendMessage.preview as ReturnType<typeof vi.fn>,
    ).mockResolvedValue(ok({ title: 'Enviar mensagem', summary: 'Olá' }))

    const proposed = expectOk(
      await proposeMcpWrite(
        sendMessage,
        CTX,
        { text: 'Olá' },
        { integrationGrantId: 'g1' },
        NOW,
      ),
    )

    const created = repo.create.mock.calls[0][0]
    expect(created).toEqual(
      expect.objectContaining({
        requestedById: 'u1',
        integrationGrantId: 'g1',
        conversationId: null,
        toolName: 'zap_message_send_text',
        expiresAt: new Date('2026-10-17T12:30:00.000Z'),
      }),
    )
    expect(created.status).toBeUndefined()
    expect(proposed.confirmPath).toBe('/demo/inbox?view=ai&action=act1')
    expect(execute).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'request',
        targetId: 'act1',
        meta: expect.objectContaining({ source: 'mcp' }),
      }),
    )
  })

  it('should propagate workspace and preview failures', async () => {
    setup()
    workspaces.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await proposeMcpWrite(sendMessage, CTX, {}, { integrationGrantId: 'g1' }),
      'DATABASE_ERROR',
    )

    setup()
    vi.mocked(
      sendMessage.preview as ReturnType<typeof vi.fn>,
    ).mockResolvedValue(err(forbidden('Sem acesso')))
    expectErr(
      await proposeMcpWrite(sendMessage, CTX, {}, { integrationGrantId: 'g1' }),
      'FORBIDDEN',
    )
    expect(repo.create).not.toHaveBeenCalled()
  })
})

describe('AiPendingActionService.confirm() — MCP actions', () => {
  it('should execute with the MCP context even with agent mode off', async () => {
    setup()

    const dto = expectOk(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
    )

    expect(dto.status).toBe('EXECUTED')
    expect(execute).toHaveBeenCalledWith(CTX, { text: 'Olá' })
    expect(logs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'MCP',
        actorId: 'u1',
        oauthClientId: 'client1',
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'confirm' }),
    )
  })

  it('should refuse when the admin turned MCP writes off', async () => {
    setup()
    mockedAccess.mockResolvedValue(ok({ ...ACCESS, mcpWriteEnabled: false }))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'MCP_WRITE_DISABLED',
    )
    expect(repo.transitionFromPending).not.toHaveBeenCalled()
  })

  it.each([
    ['revoked', { revokedAt: NOW }],
    ['without mcp:write', { scopes: ['mcp:read'] }],
    ['of another user', { userId: 'u2' }],
    ['without the module', { modules: ['CRM' as const] }],
  ])('should refuse a grant %s', async (_label, overrides) => {
    setup()
    grants.findById.mockResolvedValue(
      ok(createFakeIntegrationGrant({ ...GRANT, ...overrides })),
    )
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'AI_TOOL_NOT_ALLOWED',
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('should refuse a removed tool, a DELETE and a permission lost meanwhile', async () => {
    setup(mcpPending({ toolName: 'zap_removed' }))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'AI_TOOL_NOT_ALLOWED',
    )

    setup(mcpPending({ toolName: 'crm_delete_task', module: 'CRM' }))
    expectErr(
      await AiPendingActionService.confirm(
        'u1',
        'ws1',
        'act1',
        { doubleConfirmed: true },
        NOW,
      ),
      'AI_TOOL_NOT_ALLOWED',
    )

    setup()
    mockedAccess.mockResolvedValue(ok({ ...ACCESS, permissions: {} }))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'AI_TOOL_NOT_ALLOWED',
    )
  })

  it('should propagate a grant lookup failure', async () => {
    setup()
    grants.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'DATABASE_ERROR',
    )
  })
})
