import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSteelAgentRunWithAgent,
  createFakeSteelAgentTool,
} from '@/src/__tests__/factories/steel-agent.factory'
import { createFakeAiPendingAction } from '@/src/__tests__/factories/steel-ai.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { aiPendingActionChanged } from '@/src/errors/app-error'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'
import { SYSTEM_PROFILE_PERMISSIONS } from '@/src/lib/permissions'
import { err, ok } from '@/src/lib/result'

const registry = vi.hoisted(() => ({ tools: [] as unknown[] }))

vi.mock('@/src/lib/ai/tools/index', () => ({
  get STEEL_AI_TOOLS() {
    return registry.tools
  },
}))
vi.mock('@/src/lib/ai/tools/registry', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/lib/ai/tools/registry')>()
  type Tools = Parameters<typeof actual.findTool>[1]
  return {
    ...actual,
    resolveToolAccess: vi.fn(),
    findTool: vi.fn((name: string) =>
      actual.findTool(name, registry.tools as Tools),
    ),
  }
})
vi.mock('@/src/services/authz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/services/authz')>()),
  assertMember: vi.fn(),
}))
vi.mock('@/src/repositories/steel-agent.repository')
vi.mock('@/src/repositories/ai-pending-action.repository')
vi.mock('@/src/lib/steel-agents/enqueue')
vi.mock('@/src/services/ai-pending-action.service', () => ({
  assertPreviewUnchanged: vi.fn(),
  executeClaimedAction: vi.fn(),
}))

vi.mock('@/src/repositories/steel-agent-governance.repository')

import { resolveToolAccess } from '@/src/lib/ai/tools/registry'
import { enqueueSteelAgentRun } from '@/src/lib/steel-agents/enqueue'
import { currentSteelAgentContext } from '@/src/lib/steel-agents/run-context'
import { AiPendingActionRepository } from '@/src/repositories/ai-pending-action.repository'
import {
  SteelAgentRunRepository,
  SteelAgentRunStepRepository,
} from '@/src/repositories/steel-agent.repository'
import { SteelAgentPolicyRepository } from '@/src/repositories/steel-agent-governance.repository'
import {
  assertPreviewUnchanged,
  executeClaimedAction,
} from '@/src/services/ai-pending-action.service'
import { assertMember } from '@/src/services/authz'
import { SteelAgentApprovalService } from '../steel-agent-approval.service'

const member = vi.mocked(assertMember)
const access = vi.mocked(resolveToolAccess)
const runs = vi.mocked(SteelAgentRunRepository)
const steps = vi.mocked(SteelAgentRunStepRepository)
const pending = vi.mocked(AiPendingActionRepository)
const execute = vi.mocked(executeClaimedAction)
const unchanged = vi.mocked(assertPreviewUnchanged)
const enqueue = vi.mocked(enqueueSteelAgentRun)

const NOW = new Date('2026-10-06T12:00:00.000Z')

const createTool: AnySteelAiTool = {
  name: 'crm_create_task',
  label: 'Criando tarefa',
  module: 'CRM',
  kind: 'CREATE',
  description: '',
  parameters: { type: 'object', properties: {} },
  parse: (args) => ok(args),
  preview: vi.fn(),
  execute: vi.fn(),
}

const ADMIN = { role: 'ADMIN' as const, isPrivileged: true, permissions: null }
const MEMBER = {
  role: 'MEMBER' as const,
  isPrivileged: false,
  permissions: SYSTEM_PROFILE_PERMISSIONS.MEMBER,
}
const OWNER_ACCESS = {
  modules: ['CRM' as const],
  isPrivileged: false,
  permissions: SYSTEM_PROFILE_PERMISSIONS.MEMBER,
  agentModeEnabled: true,
  aiEnabled: true,
  agentsEnabled: true,
  autopilotEnabled: false,
}

function setup(
  options: {
    action?: Parameters<typeof createFakeAiPendingAction>[0]
    tools?: string[]
    ownerId?: string | null
  } = {},
) {
  const run = createFakeSteelAgentRunWithAgent(
    { id: 'run1', workspaceId: 'ws1', status: 'WAITING_APPROVAL' },
    {
      id: 'agent1',
      workspaceId: 'ws1',
      ownerId: options.ownerId === undefined ? 'owner1' : options.ownerId,
      tools: (options.tools ?? ['crm_create_task']).map((toolName) =>
        createFakeSteelAgentTool({ toolName, mode: 'APPROVAL' }),
      ),
    },
  )
  const action = createFakeAiPendingAction({
    id: 'act1',
    workspaceId: 'ws1',
    requestedById: null,
    conversationId: null,
    agentRunId: 'run1',
    toolName: 'crm_create_task',
    expiresAt: new Date(NOW.getTime() + 60_000),
    ...options.action,
  })
  member.mockResolvedValue(ok(ADMIN))
  runs.findForExecution.mockResolvedValue(ok(run))
  pending.findById.mockResolvedValue(ok(action))
  pending.transitionFromPending.mockImplementation(async (_id, data) =>
    ok({ ...action, ...data }),
  )
  access.mockResolvedValue(ok(OWNER_ACCESS))
  execute.mockImplementation(async (claimed) =>
    ok({
      ...claimed,
      status: 'EXECUTED',
      result: { summary: 'Tarefa criada' },
    }),
  )
  unchanged.mockResolvedValue(ok('unchanged' as const))
  steps.updateByPendingAction.mockResolvedValue(ok(1))
  enqueue.mockResolvedValue(ok(true))
  return { run, action }
}

beforeEach(() => {
  vi.mocked(SteelAgentPolicyRepository).find.mockResolvedValue(ok(null))
  registry.tools = [createTool]
})

describe('SteelAgentApprovalService.approve', () => {
  it('should execute as the owner, mark the step and resume the run', async () => {
    let context: unknown
    setup()
    execute.mockImplementation(async (claimed) => {
      context = currentSteelAgentContext()
      return ok({
        ...claimed,
        status: 'EXECUTED',
        result: { summary: 'Tarefa criada' },
      })
    })

    const dto = expectOk(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
    )

    expect(dto.status).toBe('EXECUTED')
    expect(dto.resultSummary).toBe('Tarefa criada')
    expect(pending.transitionFromPending).toHaveBeenCalledWith('act1', {
      status: 'EXECUTED',
      decidedById: 'admin1',
      decidedAt: NOW,
    })
    expect(execute).toHaveBeenCalledWith(expect.anything(), createTool, {
      ctx: {
        workspaceId: 'ws1',
        actorId: 'owner1',
        source: 'agent',
        agentId: 'agent1',
      },
      deciderId: 'admin1',
    })
    expect(context).toEqual({ agentId: 'agent1', runId: 'run1' })
    expect(access).toHaveBeenCalledWith('owner1', 'ws1')
    expect(steps.updateByPendingAction).toHaveBeenCalledWith(
      'act1',
      expect.objectContaining({ status: 'APPROVED' }),
    )
    expect(enqueue).toHaveBeenCalledWith('run1')
  })

  it('should record the failure message when the execution failed', async () => {
    setup()
    execute.mockImplementation(async (claimed) =>
      ok({ ...claimed, status: 'FAILED', error: 'Sem permissão' }),
    )
    enqueue.mockResolvedValue(err(databaseError('redis')))
    const dto = expectOk(
      await SteelAgentApprovalService.approve(
        'owner1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
    )
    expect(dto.status).toBe('FAILED')
    expect(steps.updateByPendingAction).toHaveBeenCalledWith(
      'act1',
      expect.objectContaining({ status: 'APPROVED', error: 'Sem permissão' }),
    )
  })

  it('should let the owner decide even without the steel-agents permission', async () => {
    setup()
    member.mockResolvedValue(ok(MEMBER))
    expectOk(
      await SteelAgentApprovalService.approve(
        'owner1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
    )
  })

  it('should forbid members that are neither owner nor manager', async () => {
    setup()
    member.mockResolvedValue(ok(MEMBER))
    expectErr(
      await SteelAgentApprovalService.approve(
        'm1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'FORBIDDEN',
    )
  })

  it('should propagate membership and loading errors', async () => {
    setup()
    member.mockResolvedValue(err(forbidden()))
    expectErr(
      await SteelAgentApprovalService.approve(
        'x',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'FORBIDDEN',
    )

    setup()
    runs.findForExecution.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'DATABASE_ERROR',
    )

    setup()
    pending.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })

  it('should 404 a run from another workspace or an action from another run', async () => {
    setup()
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws2',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'STEEL_AGENT_RUN_NOT_FOUND',
    )

    setup({ action: { agentRunId: 'other' } })
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'AI_PENDING_ACTION_NOT_FOUND',
    )
  })

  it('should be idempotent for already executed actions', async () => {
    setup({ action: { status: 'EXECUTED' } })
    const dto = expectOk(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
    )
    expect(dto.status).toBe('EXECUTED')
    expect(execute).not.toHaveBeenCalled()

    setup({ action: { status: 'EXPIRED' } })
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'AI_PENDING_ACTION_EXPIRED',
    )

    setup({ action: { status: 'CANCELED' } })
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'AI_PENDING_ACTION_NOT_PENDING',
    )
  })

  it('should expire an overdue action and resume the run', async () => {
    setup({ action: { expiresAt: new Date(NOW.getTime() - 1) } })
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'AI_PENDING_ACTION_EXPIRED',
    )
    expect(pending.transitionFromPending).toHaveBeenCalledWith('act1', {
      status: 'EXPIRED',
    })
    expect(steps.updateByPendingAction).toHaveBeenCalledWith('act1', {
      status: 'EXPIRED',
    })
    expect(enqueue).toHaveBeenCalledWith('run1')

    setup({ action: { expiresAt: new Date(NOW.getTime() - 1) } })
    pending.transitionFromPending.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })

  it('should require a double confirmation for DELETE', async () => {
    setup({ action: { kind: 'DELETE', requiresDoubleConfirm: true } })
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'AI_DOUBLE_CONFIRMATION_REQUIRED',
    )
    expectOk(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        { doubleConfirmed: true },
        NOW,
      ),
    )
  })

  it('should refuse when the owner lost access or agent mode is off', async () => {
    setup({ ownerId: null })
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'AI_TOOL_NOT_ALLOWED',
    )

    setup()
    access.mockResolvedValue(err(forbidden()))
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'AI_TOOL_NOT_ALLOWED',
    )

    setup()
    access.mockResolvedValue(ok({ ...OWNER_ACCESS, agentModeEnabled: false }))
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'AI_AGENT_MODE_DISABLED',
    )
  })

  it('should refuse tools removed from the agent, the registry or the owner profile', async () => {
    setup({ tools: [] })
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'AI_TOOL_NOT_ALLOWED',
    )

    setup()
    registry.tools = []
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'AI_TOOL_NOT_ALLOWED',
    )

    registry.tools = [createTool]
    setup()
    access.mockResolvedValue(ok({ ...OWNER_ACCESS, modules: [] }))
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'AI_TOOL_NOT_ALLOWED',
    )
  })

  it('should check the preview as the owner and refuse when the record changed', async () => {
    const { action } = setup()
    unchanged.mockResolvedValue(err(aiPendingActionChanged({ action: {} })))

    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'AI_PENDING_ACTION_CHANGED',
    )

    expect(unchanged).toHaveBeenCalledWith(
      action,
      createTool,
      {
        workspaceId: 'ws1',
        actorId: 'owner1',
        source: 'agent',
        agentId: 'agent1',
      },
      'admin1',
    )
    expect(pending.transitionFromPending).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('should answer with the outcome of a decision made during the preview check', async () => {
    const { action } = setup()
    unchanged.mockResolvedValue(ok('decided' as const))
    pending.findById
      .mockResolvedValueOnce(ok(action))
      .mockResolvedValueOnce(ok({ ...action, status: 'EXECUTED' }))

    const dto = expectOk(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
    )
    expect(dto.status).toBe('EXECUTED')
    expect(execute).not.toHaveBeenCalled()
  })

  it('should return the winner outcome when the claim is lost', async () => {
    const { action } = setup()
    pending.transitionFromPending.mockResolvedValue(ok(null))
    pending.findById
      .mockResolvedValueOnce(ok(action))
      .mockResolvedValueOnce(ok({ ...action, status: 'EXECUTED' }))
    const dto = expectOk(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
    )
    expect(dto.status).toBe('EXECUTED')
    expect(execute).not.toHaveBeenCalled()

    setup()
    pending.transitionFromPending.mockResolvedValue(ok(null))
    pending.findById
      .mockResolvedValueOnce(ok(action))
      .mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })

  it('should propagate claim and execution errors', async () => {
    setup()
    pending.transitionFromPending.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'DATABASE_ERROR',
    )

    setup()
    execute.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentApprovalService.approve(
        'admin1',
        'ws1',
        'run1',
        'act1',
        {},
        NOW,
      ),
      'DATABASE_ERROR',
    )
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('SteelAgentApprovalService.reject', () => {
  it('should cancel the action, mark the step and resume', async () => {
    setup()
    const dto = expectOk(
      await SteelAgentApprovalService.reject(
        'admin1',
        'ws1',
        'run1',
        'act1',
        NOW,
      ),
    )
    expect(dto.status).toBe('CANCELED')
    expect(pending.transitionFromPending).toHaveBeenCalledWith('act1', {
      status: 'CANCELED',
      decidedById: 'admin1',
      decidedAt: NOW,
    })
    expect(steps.updateByPendingAction).toHaveBeenCalledWith('act1', {
      status: 'REJECTED',
    })
    expect(enqueue).toHaveBeenCalledWith('run1')
  })

  it('should refuse decided actions and propagate errors', async () => {
    setup()
    pending.transitionFromPending.mockResolvedValue(ok(null))
    expectErr(
      await SteelAgentApprovalService.reject('admin1', 'ws1', 'run1', 'act1'),
      'AI_PENDING_ACTION_NOT_PENDING',
    )

    setup()
    pending.transitionFromPending.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentApprovalService.reject('admin1', 'ws1', 'run1', 'act1'),
      'DATABASE_ERROR',
    )

    setup()
    member.mockResolvedValue(ok(MEMBER))
    expectErr(
      await SteelAgentApprovalService.reject('m1', 'ws1', 'run1', 'act1'),
      'FORBIDDEN',
    )
  })
})
