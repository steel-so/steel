import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWorkspaceAiSettings } from '@/src/__tests__/factories/ai-settings.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeAiActionLog,
  createFakeAiPendingAction,
} from '@/src/__tests__/factories/steel-ai.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { aiPendingActionNotFound } from '@/src/errors/app-error'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'
import { err, ok } from '@/src/lib/result'

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
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { resolveToolAccess } from '@/src/lib/ai/tools/registry'
import { AiActionLogRepository } from '@/src/repositories/ai-action-log.repository'
import { AiMessageRepository } from '@/src/repositories/ai-conversation.repository'
import { AiPendingActionRepository } from '@/src/repositories/ai-pending-action.repository'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  AiPendingActionService,
  assertPreviewUnchanged,
  executeAutopilotWrite,
  executeClaimedAction,
} from '../ai-pending-action.service'

const aiSettings = vi.mocked(WorkspaceAiSettingsRepository)

const mockedAccess = vi.mocked(resolveToolAccess)
const repo = vi.mocked(AiPendingActionRepository)
const logs = vi.mocked(AiActionLogRepository)
const messages = vi.mocked(AiMessageRepository)
const memberships = vi.mocked(MembershipRepository)
const audit = vi.mocked(auditMutation)

const ACCESS = {
  modules: ['CRM' as const],
  isPrivileged: false,
  permissions: { tasks: ['VIEW' as const, 'CREATE' as const] },
  agentModeEnabled: true,
  aiEnabled: true,
  agentsEnabled: true,
  autopilotEnabled: false,
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
const deleteTask: AnySteelAiTool = {
  ...createTask,
  name: 'crm_delete_task',
  kind: 'DELETE',
  permission: { resource: 'tasks', action: 'DELETE' },
}

const NOW = new Date('2026-10-06T12:10:00.000Z')

function pending(overrides = {}) {
  return createFakeAiPendingAction({
    id: 'act1',
    workspaceId: 'ws1',
    requestedById: 'u1',
    conversationId: 'conv1',
    toolCallId: 'call_1',
    toolName: 'crm_create_task',
    args: { title: 'Ligar' },
    expiresAt: new Date('2026-10-06T12:30:00.000Z'),
    ...overrides,
  })
}

function setup(action = pending()) {
  mockedAccess.mockResolvedValue(ok(ACCESS))
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  repo.findById.mockResolvedValue(ok(action))
  repo.transitionFromPending.mockImplementation(async (id, data) =>
    ok({ ...action, id, ...data }),
  )
  repo.complete.mockImplementation(async (id, data) =>
    ok({ ...action, id, ...data, result: (data.result ?? null) as never }),
  )
  repo.expireOverdue.mockResolvedValue(ok(0))
  repo.listByRequester.mockResolvedValue(ok([action]))
  logs.create.mockResolvedValue(ok(createFakeAiActionLog()))
  messages.createMany.mockResolvedValue(ok([]))
  aiSettings.findByWorkspace.mockResolvedValue(ok(null))
}

beforeEach(() => {
  tools.list = [createTask, deleteTask]
  execute.mockResolvedValue(
    ok({
      data: { id: 'task1' },
      summary: 'Tarefa “Ligar” criada',
      target: { type: 'crm_task', id: 'task1', label: 'Ligar' },
    }),
  )
})

describe('AiPendingActionService.confirm()', () => {
  it('should claim, execute, log, audit and append the result', async () => {
    setup()

    const dto = expectOk(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
    )

    expect(repo.transitionFromPending).toHaveBeenCalledWith('act1', {
      status: 'EXECUTED',
      decidedById: 'u1',
      decidedAt: NOW,
    })
    expect(execute).toHaveBeenCalledWith(
      { workspaceId: 'ws1', actorId: 'u1', source: 'assistant' },
      { title: 'Ligar' },
    )
    expect(dto.status).toBe('EXECUTED')
    expect(dto.resultSummary).toBe('Tarefa “Ligar” criada')
    expect(logs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        source: 'ASSISTANT',
        actorId: 'u1',
        pendingActionId: 'act1',
        targetType: 'crm_task',
        targetId: 'task1',
        outcome: 'success',
        summary: 'Tarefa “Ligar” criada',
        error: null,
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'ai_pending_action',
        action: 'confirm',
        actorId: 'u1',
        targetId: 'act1',
        outcome: 'success',
      }),
    )
    const row = messages.createMany.mock.calls[0][0][0]
    expect(row).toEqual(
      expect.objectContaining({
        conversationId: 'conv1',
        role: 'TOOL',
        toolCallId: 'action:act1',
        toolName: 'crm_create_task',
      }),
    )
    expect(JSON.parse(row.content)).toEqual(
      expect.objectContaining({ status: 'executed', actionId: 'act1' }),
    )
  })

  it('should mark the action FAILED when the tool fails', async () => {
    setup()
    execute.mockResolvedValue(err(forbidden('Sem permissão')))

    const dto = expectOk(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
    )

    expect(repo.complete).toHaveBeenCalledWith('act1', {
      status: 'FAILED',
      error: 'Sem permissão',
    })
    expect(dto.status).toBe('FAILED')
    expect(logs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        summary: null,
        error: 'Sem permissão',
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', reason: 'FORBIDDEN' }),
    )
    expect(
      JSON.parse(messages.createMany.mock.calls[0][0][0].content).status,
    ).toBe('failed')
  })

  it('should return the outcome without executing again on a second click', async () => {
    setup(pending({ status: 'EXECUTED', result: { summary: 'feito' } }))
    const dto = expectOk(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
    )
    expect(dto.status).toBe('EXECUTED')
    expect(execute).not.toHaveBeenCalled()
    expect(repo.transitionFromPending).not.toHaveBeenCalled()
  })

  it('should return the winner outcome when a concurrent confirm claimed it first', async () => {
    setup()
    repo.transitionFromPending.mockResolvedValue(ok(null))
    repo.findById
      .mockResolvedValueOnce(ok(pending()))
      .mockResolvedValueOnce(ok(pending({ status: 'FAILED' })))

    const dto = expectOk(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
    )
    expect(dto.status).toBe('FAILED')
    expect(execute).not.toHaveBeenCalled()
  })

  it('should propagate a reload failure after losing the claim', async () => {
    setup()
    repo.transitionFromPending.mockResolvedValue(ok(null))
    repo.findById
      .mockResolvedValueOnce(ok(pending()))
      .mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'DATABASE_ERROR',
    )
  })

  it.each([
    ['CANCELED', 'AI_PENDING_ACTION_NOT_PENDING'],
    ['EXPIRED', 'AI_PENDING_ACTION_EXPIRED'],
  ] as const)('should refuse a %s action', async (status, code) => {
    setup(pending({ status }))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      code,
    )
  })

  it('should expire an overdue action instead of executing it', async () => {
    setup(pending({ expiresAt: new Date('2026-10-06T12:00:00.000Z') }))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'AI_PENDING_ACTION_EXPIRED',
    )
    expect(repo.transitionFromPending).toHaveBeenCalledWith('act1', {
      status: 'EXPIRED',
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('should propagate a failure while expiring', async () => {
    setup(pending({ expiresAt: new Date('2026-10-06T12:00:00.000Z') }))
    repo.transitionFromPending.mockResolvedValue(err(databaseError()))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'DATABASE_ERROR',
    )
  })

  it('should answer 404 for an action requested by someone else', async () => {
    setup(pending({ requestedById: 'u2' }))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'AI_PENDING_ACTION_NOT_FOUND',
    )
  })

  it('should propagate a missing action', async () => {
    setup()
    repo.findById.mockResolvedValue(err(aiPendingActionNotFound()))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'AI_PENDING_ACTION_NOT_FOUND',
    )
  })

  it('should require the double confirmation for deletes', async () => {
    tools.list = [createTask, deleteTask]
    setup(
      pending({
        toolName: 'crm_delete_task',
        kind: 'DELETE',
        requiresDoubleConfirm: true,
      }),
    )
    mockedAccess.mockResolvedValue(ok({ ...ACCESS, isPrivileged: true }))

    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'AI_DOUBLE_CONFIRMATION_REQUIRED',
    )
    expectOk(
      await AiPendingActionService.confirm(
        'u1',
        'ws1',
        'act1',
        { doubleConfirmed: true },
        NOW,
      ),
    )
  })

  it('should refuse when the agent mode was switched off meanwhile', async () => {
    setup()
    mockedAccess.mockResolvedValue(ok({ ...ACCESS, agentModeEnabled: false }))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'AI_AGENT_MODE_DISABLED',
    )
  })

  it('should refuse when the permission was revoked meanwhile', async () => {
    setup(pending({ toolName: 'crm_delete_task', kind: 'DELETE' }))
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
    expect(repo.transitionFromPending).not.toHaveBeenCalled()
  })

  it('should refuse a tool that no longer exists', async () => {
    setup(pending({ toolName: 'crm_removed_tool' }))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'AI_TOOL_NOT_ALLOWED',
    )
  })

  it('should propagate access, claim and completion failures', async () => {
    setup()
    mockedAccess.mockResolvedValue(err(forbidden()))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'FORBIDDEN',
    )

    setup()
    repo.transitionFromPending.mockResolvedValue(err(databaseError()))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'DATABASE_ERROR',
    )

    setup()
    repo.complete.mockResolvedValue(err(databaseError()))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'DATABASE_ERROR',
    )
  })

  it('should still succeed when the log and the transcript append fail', async () => {
    setup()
    logs.create.mockResolvedValue(err(databaseError()))
    messages.createMany.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(
        await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      ).status,
    ).toBe('EXECUTED')
  })
})

describe('AiPendingActionService.confirm() — stale preview', () => {
  const SHOWN = {
    title: 'Atualizar a tarefa “Ligar”',
    summary: '1 campo(s) alterado(s).',
    fields: [{ label: 'Status', before: 'A fazer', after: 'Concluída' }],
  }
  const preview = vi.mocked(
    createTask.preview as NonNullable<AnySteelAiTool['preview']>,
  )

  function setupShown() {
    const action = pending({ preview: SHOWN })
    setup(action)
    repo.refreshPreview.mockImplementation(async (id, fresh) =>
      ok({ ...action, id, preview: fresh as never }),
    )
    return action
  }

  it('should execute when the rebuilt preview is the one confirmed', async () => {
    setupShown()
    // Same content, other key order and an explicit undefined (JSONB copy).
    preview.mockResolvedValue(
      ok({
        fields: [{ after: 'Concluída', before: 'A fazer', label: 'Status' }],
        summary: SHOWN.summary,
        title: SHOWN.title,
        target: undefined,
      }),
    )

    const dto = expectOk(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
    )

    expect(dto.status).toBe('EXECUTED')
    expect(preview).toHaveBeenCalledWith(
      { workspaceId: 'ws1', actorId: 'u1', source: 'assistant' },
      { title: 'Ligar' },
    )
    expect(repo.refreshPreview).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledOnce()
  })

  it('should refuse, keep it pending and store the fresh preview when the record changed', async () => {
    setupShown()
    const fresh = {
      ...SHOWN,
      title: 'Atualizar a tarefa “Ligar para a Acme”',
      fields: [{ label: 'Status', before: 'Em andamento', after: 'Concluída' }],
    }
    preview.mockResolvedValue(ok(fresh))

    const error = expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'AI_PENDING_ACTION_CHANGED',
    )

    expect(error.message).toBe(
      'O registro mudou desde a prévia. Revise e confirme de novo.',
    )
    expect(
      (error.details as { action: { status: string; preview: unknown } })
        .action,
    ).toEqual(expect.objectContaining({ status: 'PENDING', preview: fresh }))
    expect(repo.refreshPreview).toHaveBeenCalledWith('act1', fresh)
    expect(repo.transitionFromPending).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'ai_pending_action',
        action: 'confirm',
        outcome: 'failure',
        reason: 'AI_PENDING_ACTION_CHANGED',
        targetId: 'act1',
      }),
    )
  })

  it('should answer with the other click outcome when it was decided meanwhile', async () => {
    const action = setupShown()
    preview.mockResolvedValue(ok({ ...SHOWN, summary: 'mudou' }))
    repo.refreshPreview.mockResolvedValue(ok(null))
    repo.findById
      .mockResolvedValueOnce(ok(action))
      .mockResolvedValueOnce(ok({ ...action, status: 'EXECUTED' }))

    const dto = expectOk(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
    )

    expect(dto.status).toBe('EXECUTED')
    expect(execute).not.toHaveBeenCalled()
  })

  it('should propagate a failure while storing the fresh preview', async () => {
    setupShown()
    preview.mockResolvedValue(ok({ ...SHOWN, summary: 'mudou' }))
    repo.refreshPreview.mockResolvedValue(err(databaseError()))

    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      'DATABASE_ERROR',
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('should let execute decide when the preview cannot be rebuilt', async () => {
    setupShown()
    preview.mockResolvedValueOnce(err(forbidden()))
    expect(
      expectOk(
        await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      ).status,
    ).toBe('EXECUTED')

    setupShown()
    preview.mockRejectedValueOnce(new Error('boom'))
    expect(
      expectOk(
        await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}, NOW),
      ).status,
    ).toBe('EXECUTED')
    expect(repo.refreshPreview).not.toHaveBeenCalled()
  })

  it('assertPreviewUnchanged() should pass tools without preview and bad args', async () => {
    const action = pending({ preview: SHOWN })
    const ctx = {
      workspaceId: 'ws1',
      actorId: 'u1',
      source: 'assistant' as const,
    }
    expect(
      expectOk(
        await assertPreviewUnchanged(
          action,
          { ...createTask, preview: undefined },
          ctx,
          'u1',
        ),
      ),
    ).toBe('unchanged')
    expect(
      expectOk(
        await assertPreviewUnchanged(
          action,
          { ...createTask, parse: () => err(forbidden()) },
          ctx,
          'u1',
        ),
      ),
    ).toBe('unchanged')
    expect(preview).not.toHaveBeenCalled()
  })
})

describe('executeClaimedAction()', () => {
  it('should log agent runs without a conversation', async () => {
    setup()
    const action = pending({
      conversationId: null,
      requestedById: null,
      agentRunId: 'run1',
    })
    execute.mockResolvedValue(ok({ data: null, summary: 'ok' }))

    expectOk(
      await executeClaimedAction(action, createTask, {
        ctx: {
          workspaceId: 'ws1',
          actorId: 'owner',
          source: 'agent',
          agentId: 'agent1',
        },
        deciderId: null,
      }),
    )

    expect(logs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'AGENT',
        actorId: null,
        agentId: 'agent1',
        targetType: null,
        targetId: null,
      }),
    )
    expect(messages.createMany).not.toHaveBeenCalled()
  })
})

describe('AiPendingActionService.cancel()', () => {
  it('should cancel, audit and tell the model', async () => {
    setup()
    const dto = expectOk(
      await AiPendingActionService.cancel('u1', 'ws1', 'act1', NOW),
    )
    expect(dto.status).toBe('CANCELED')
    expect(repo.transitionFromPending).toHaveBeenCalledWith('act1', {
      status: 'CANCELED',
      decidedById: 'u1',
      decidedAt: NOW,
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'ai_pending_action',
        action: 'cancel',
      }),
    )
    expect(
      JSON.parse(messages.createMany.mock.calls[0][0][0].content).status,
    ).toBe('canceled')
  })

  it('should refuse an action that is no longer pending', async () => {
    setup()
    repo.transitionFromPending.mockResolvedValue(ok(null))
    expectErr(
      await AiPendingActionService.cancel('u1', 'ws1', 'act1'),
      'AI_PENDING_ACTION_NOT_PENDING',
    )
  })

  it('should propagate membership, ownership and transition failures', async () => {
    setup()
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await AiPendingActionService.cancel('u1', 'ws1', 'act1'),
      'FORBIDDEN',
    )

    setup(pending({ requestedById: 'u2' }))
    expectErr(
      await AiPendingActionService.cancel('u1', 'ws1', 'act1'),
      'AI_PENDING_ACTION_NOT_FOUND',
    )

    setup()
    repo.transitionFromPending.mockResolvedValue(err(databaseError()))
    expectErr(
      await AiPendingActionService.cancel('u1', 'ws1', 'act1'),
      'DATABASE_ERROR',
    )
  })
})

describe('AiPendingActionService.list()', () => {
  it('should expire overdue actions and list only the caller ones', async () => {
    setup()
    const list = expectOk(
      await AiPendingActionService.list('u1', 'ws1', { status: 'PENDING' }),
    )
    expect(list).toHaveLength(1)
    expect(repo.expireOverdue).toHaveBeenCalledWith('ws1')
    expect(repo.listByRequester).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      requestedById: 'u1',
      status: 'PENDING',
    })
  })

  it('should propagate failures', async () => {
    setup()
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await AiPendingActionService.list('u1', 'ws1'), 'FORBIDDEN')

    setup()
    repo.expireOverdue.mockResolvedValue(err(databaseError()))
    expectErr(await AiPendingActionService.list('u1', 'ws1'), 'DATABASE_ERROR')

    setup()
    repo.listByRequester.mockResolvedValue(err(databaseError()))
    expectErr(await AiPendingActionService.list('u1', 'ws1'), 'DATABASE_ERROR')
  })
})

describe('Steel AI 2 — master switch and Autopilot', () => {
  it('should refuse list, confirm and cancel when the AI is off', async () => {
    setup()
    aiSettings.findByWorkspace.mockResolvedValue(
      ok(createFakeWorkspaceAiSettings({ aiEnabled: false })),
    )
    expectErr(await AiPendingActionService.list('u1', 'ws1'), 'AI_DISABLED')
    expectErr(
      await AiPendingActionService.cancel('u1', 'ws1', 'act1'),
      'AI_DISABLED',
    )
    mockedAccess.mockResolvedValue(ok({ ...ACCESS, aiEnabled: false }))
    expectErr(
      await AiPendingActionService.confirm('u1', 'ws1', 'act1', {}),
      'AI_DISABLED',
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('executeAutopilotWrite() should create a claimed action, run it and log it', async () => {
    setup()
    repo.create.mockImplementation(async (data) =>
      ok(
        pending({
          ...data,
          args: data.args as never,
          preview: data.preview as never,
        }),
      ),
    )
    vi.mocked(createTask.preview as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ title: 'Criar tarefa “Ligar”', summary: 'x' }),
    )
    const ctx = {
      workspaceId: 'ws1',
      actorId: 'u1',
      source: 'assistant' as const,
    }

    const done = expectOk(
      await executeAutopilotWrite(
        createTask,
        ctx,
        { title: 'Ligar' },
        { conversationId: 'conv1', toolCallId: 'call_1' },
        NOW,
      ),
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'EXECUTED',
        decidedById: 'u1',
        decidedAt: NOW,
        autoExecuted: true,
        requestedById: 'u1',
      }),
    )
    expect(done.action.status).toBe('EXECUTED')
    expect(JSON.parse(done.content)).toEqual(
      expect.objectContaining({
        status: 'executed',
        summary: 'Tarefa “Ligar” criada',
      }),
    )
    expect(logs.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ASSISTANT', actorId: 'u1' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auto_execute',
        meta: expect.objectContaining({ mode: 'AUTOPILOT' }),
      }),
    )
    // The turn persists the TOOL row itself: no decision note appended.
    expect(messages.createMany).not.toHaveBeenCalled()
  })

  it('executeAutopilotWrite() should report failures to the model', async () => {
    setup()
    repo.create.mockImplementation(async (data) =>
      ok(
        pending({
          ...data,
          args: data.args as never,
          preview: data.preview as never,
        }),
      ),
    )
    vi.mocked(createTask.preview as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ title: 'Criar', summary: 'x' }),
    )
    execute.mockResolvedValue(err(forbidden('Sem permissão')))
    const ctx = {
      workspaceId: 'ws1',
      actorId: 'u1',
      source: 'assistant' as const,
    }
    const failed = expectOk(
      await executeAutopilotWrite(
        createTask,
        ctx,
        {},
        {
          conversationId: 'conv1',
          toolCallId: 'call_1',
        },
      ),
    )
    expect(failed.action.status).toBe('FAILED')
    expect(JSON.parse(failed.content)).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: expect.objectContaining({ message: 'Sem permissão' }),
      }),
    )

    repo.complete.mockResolvedValue(err(databaseError()))
    expectErr(
      await executeAutopilotWrite(
        createTask,
        ctx,
        {},
        {
          conversationId: 'conv1',
          toolCallId: 'call_1',
        },
      ),
      'DATABASE_ERROR',
    )

    repo.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await executeAutopilotWrite(
        createTask,
        ctx,
        {},
        {
          conversationId: 'conv1',
          toolCallId: 'call_1',
        },
      ),
      'DATABASE_ERROR',
    )
  })
})
