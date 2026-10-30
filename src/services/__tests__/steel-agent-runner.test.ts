import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSteelAgentVersion } from '@/src/__tests__/factories/nov-a2-agent-versions.factory'
import {
  createFakeSteelAgentRunWithAgent,
  createFakeSteelAgentTool,
} from '@/src/__tests__/factories/steel-agent.factory'
import { createFakeAiPendingAction } from '@/src/__tests__/factories/steel-ai.factory'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  aiProviderUnavailable,
  aiQuotaExceeded,
  databaseError,
  forbidden,
  notFound,
  workspaceSuspended,
} from '@/src/errors'
import { validationError } from '@/src/errors/app-error'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'
import type {
  AiChatRequest,
  AiChatResponse,
  AiProvider,
  AiToolCall,
} from '@/src/lib/ai/types'
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
  type Tools = Parameters<typeof actual.availableTools>[2]
  return {
    ...actual,
    resolveToolAccess: vi.fn(),
    findTool: vi.fn((name: string) =>
      actual.findTool(name, registry.tools as Tools),
    ),
    availableTools: vi.fn(
      (access: Parameters<typeof actual.availableTools>[0], mode: 'AGENT') =>
        actual.availableTools(access, mode, registry.tools as Tools),
    ),
  }
})
vi.mock('@/src/repositories/steel-agent.repository')
vi.mock('@/src/repositories/steel-agent-version.repository')
vi.mock('@/src/repositories/ai-action-log.repository')
vi.mock('@/src/repositories/ai-pending-action.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/services/steel-agent-notifications')

vi.mock('@/src/repositories/steel-agent-governance.repository')
vi.mock('@/src/repositories/steel-mcp-server.repository')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/lib/steel-agents/mcp-client')

import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSteelAgentPolicy,
  createFakeSteelMcpServer,
} from '@/src/__tests__/factories/nov-ai-governance.factory'
import { resolveToolAccess } from '@/src/lib/ai/tools/registry'
import { callMcpTool } from '@/src/lib/steel-agents/mcp-client'
import { currentSteelAgentContext } from '@/src/lib/steel-agents/run-context'
import { AiActionLogRepository } from '@/src/repositories/ai-action-log.repository'
import { AiPendingActionRepository } from '@/src/repositories/ai-pending-action.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  SteelAgentDelegateRepository,
  SteelAgentRunRepository,
  SteelAgentRunStepRepository,
} from '@/src/repositories/steel-agent.repository'
import { SteelAgentPolicyRepository } from '@/src/repositories/steel-agent-governance.repository'
import { SteelAgentVersionRepository } from '@/src/repositories/steel-agent-version.repository'
import { SteelMcpServerRepository } from '@/src/repositories/steel-mcp-server.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import {
  AiUsageService,
  type PreparedAiCall,
} from '@/src/services/ai-usage.service'
import {
  notifyAgentApprovalRequested,
  notifyAgentRunFailed,
} from '@/src/services/steel-agent-notifications'
import {
  executeSteelAgentRun,
  STEEL_AGENT_APPROVAL_TTL_MS,
} from '../steel-agent-runner'

const access = vi.mocked(resolveToolAccess)
const runs = vi.mocked(SteelAgentRunRepository)
const steps = vi.mocked(SteelAgentRunStepRepository)
const logs = vi.mocked(AiActionLogRepository)
const pending = vi.mocked(AiPendingActionRepository)
const usage = vi.mocked(AiUsageService)

const ACCESS = {
  modules: ['SERVICE_DESK' as const, 'CRM' as const],
  isPrivileged: true,
  permissions: null,
  agentModeEnabled: true,
  aiEnabled: true,
  agentsEnabled: true,
  autopilotEnabled: false,
}

const readExecute = vi.fn()
const createExecute = vi.fn()
const deleteExecute = vi.fn()

const readTool: AnySteelAiTool = {
  name: 'sd_list_tickets',
  label: 'Consultando chamados',
  module: 'SERVICE_DESK',
  kind: 'READ',
  description: 'Lista chamados',
  parameters: { type: 'object', properties: {} },
  parse: (args) => (args.bad ? err(validationError('Inválido')) : ok(args)),
  execute: readExecute,
}
const createTool: AnySteelAiTool = {
  name: 'crm_create_task',
  label: 'Criando tarefa',
  module: 'CRM',
  kind: 'CREATE',
  description: 'Cria tarefa',
  parameters: { type: 'object', properties: {} },
  parse: (args) => ok(args),
  preview: async () => ok({ title: 'Criar tarefa “Ligar”', summary: 'Ligar' }),
  execute: createExecute,
}
const deleteTool: AnySteelAiTool = {
  name: 'crm_delete_task',
  label: 'Excluindo tarefa',
  module: 'CRM',
  kind: 'DELETE',
  description: 'Exclui tarefa',
  parameters: { type: 'object', properties: {} },
  parse: (args) => ok(args),
  preview: async () => ok({ title: 'Excluir tarefa', summary: 'Excluir' }),
  execute: deleteExecute,
}

function response(overrides: Partial<AiChatResponse> = {}): AiChatResponse {
  const toolCalls = overrides.toolCalls ?? []
  const text = overrides.text ?? ''
  return {
    text,
    toolCalls,
    message: {
      role: 'assistant',
      content: text,
      ...(toolCalls.length > 0 && { toolCalls }),
    },
    usage: { inputTokens: 100, outputTokens: 50 },
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'end',
    ...overrides,
  }
}

const call = (
  name: string,
  args: Record<string, unknown> = {},
): AiToolCall => ({
  id: `call_${name}`,
  name,
  arguments: args,
})

function fakeProvider(rounds: (Partial<AiChatResponse> | Error)[]) {
  const requests: AiChatRequest[] = []
  const chat = vi.fn(async (request: AiChatRequest) => {
    requests.push(structuredClone(request))
    const next = rounds.shift() ?? { text: 'Pronto.' }
    if (next instanceof Error) throw next
    return response(next)
  })
  return {
    provider: {
      id: 'openai',
      chat,
      chatStream: vi.fn(),
    } as unknown as AiProvider,
    chat,
    requests,
  }
}

function prepared(provider: AiProvider): PreparedAiCall {
  return {
    feature: 'STEEL_AGENT',
    provider,
    model: {
      key: 'openai:gpt-4o-mini',
      provider: 'openai',
      model: 'gpt-4o-mini',
      label: 'GPT-4o mini',
    },
    usdPer1kTokens: 4,
  }
}

type Run = ReturnType<typeof createFakeSteelAgentRunWithAgent>

function setup(
  options: {
    rounds?: (Partial<AiChatResponse> | Error)[]
    run?: Parameters<typeof createFakeSteelAgentRunWithAgent>[0]
    agent?: Parameters<typeof createFakeSteelAgentRunWithAgent>[1]
    tools?: { toolName: string; mode: 'AUTO' | 'APPROVAL' }[]
  } = {},
): { run: Run; fake: ReturnType<typeof fakeProvider> } {
  const fake = fakeProvider(options.rounds ?? [])
  const run = createFakeSteelAgentRunWithAgent(
    { id: 'run1', workspaceId: 'ws1', ...options.run },
    {
      id: 'agent1',
      workspaceId: 'ws1',
      ownerId: 'owner1',
      ...options.agent,
      tools: (
        options.tools ?? [{ toolName: 'sd_list_tickets', mode: 'APPROVAL' }]
      ).map((t) => createFakeSteelAgentTool({ agentId: 'agent1', ...t })),
    },
  )
  runs.findForExecution.mockResolvedValue(ok(run))
  runs.claim.mockResolvedValue(ok(true))
  runs.update.mockImplementation(async (id) => ok({ ...run, id } as never))
  runs.listActions.mockResolvedValue(ok([]))
  runs.countSince.mockResolvedValue(ok(1))
  steps.create.mockResolvedValue(ok({} as never))
  logs.create.mockResolvedValue(ok({} as never))
  pending.create.mockImplementation(async (data) =>
    ok(
      createFakeAiPendingAction({
        id: `act_${data.toolName}`,
        ...data,
        args: data.args as never,
        preview: data.preview as never,
      }),
    ),
  )
  access.mockResolvedValue(ok(ACCESS))
  usage.prepare.mockResolvedValue(ok(prepared(fake.provider)))
  usage.record.mockResolvedValue(undefined)
  usage.price.mockReturnValue(0.25)
  vi.mocked(UserRepository.findById).mockResolvedValue(
    ok(createFakeUser({ name: 'Ana' })),
  )
  vi.mocked(WorkspaceRepository.findById).mockResolvedValue(
    ok(createFakeWorkspace({ name: 'Acme' })),
  )
  vi.mocked(notifyAgentApprovalRequested).mockResolvedValue(1)
  vi.mocked(notifyAgentRunFailed).mockResolvedValue(1)
  return { run, fake }
}

function lastUpdate() {
  const calls = runs.update.mock.calls
  return calls[calls.length - 1]?.[1] as Record<string, unknown>
}

beforeEach(() => {
  vi.mocked(SteelAgentPolicyRepository).find.mockResolvedValue(ok(null))
  vi.mocked(SteelMcpServerRepository).listByWorkspace.mockResolvedValue(ok([]))
  vi.mocked(SteelAgentDelegateRepository).listTargets.mockResolvedValue(ok([]))
  vi.mocked(SteelAgentDelegateRepository).runChain.mockResolvedValue(
    ok(['agent1']),
  )
  registry.tools = [readTool, createTool, deleteTool]
  readExecute.mockResolvedValue(
    ok({ data: [{ id: 't1' }], summary: '1 chamado' }),
  )
  createExecute.mockResolvedValue(
    ok({
      data: { id: 'task1' },
      summary: 'Tarefa criada',
      target: { type: 'crm_task', id: 'task1' },
    }),
  )
  deleteExecute.mockResolvedValue(ok({ data: {}, summary: 'Excluída' }))
})

describe('executeSteelAgentRun — tools', () => {
  it('should run READ tools with the owner identity and finish SUCCEEDED', async () => {
    const { fake } = setup({
      rounds: [
        { toolCalls: [call('sd_list_tickets')] },
        { text: 'Há 1 chamado.' },
      ],
    })

    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')

    expect(readExecute).toHaveBeenCalledWith(
      {
        workspaceId: 'ws1',
        actorId: 'owner1',
        source: 'agent',
        agentId: 'agent1',
      },
      {},
    )
    expect(runs.claim).toHaveBeenCalledWith(
      'run1',
      ['QUEUED'],
      expect.objectContaining({
        status: 'RUNNING',
        modelKey: 'openai:gpt-4o-mini',
      }),
    )
    expect(fake.requests[0].tools?.map((t) => t.name)).toEqual([
      'sd_list_tickets',
    ])
    expect(fake.requests[0].system).toContain('Classifique cada chamado novo.')
    expect(fake.requests[0].messages[0]).toEqual(
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('manual'),
      }),
    )
    expect(lastUpdate()).toEqual(
      expect.objectContaining({
        status: 'SUCCEEDED',
        summary: 'Há 1 chamado.',
        inputTokens: { increment: 200 },
        outputTokens: { increment: 100 },
        rounds: { increment: 2 },
      }),
    )
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'TOOL',
        status: 'OK',
        toolName: 'sd_list_tickets',
      }),
    )
    expect(usage.record).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: 'ws1',
      userId: null,
      usage: { inputTokens: 200, outputTokens: 100, cachedInputTokens: 0 },
    })
    expect(lastUpdate().costUsd).toEqual({ increment: 0.25 })
    expect(usage.prepare).toHaveBeenCalledWith('ws1', 'STEEL_AGENT', null)
  })

  it('should record a failed READ tool as a FAILED step', async () => {
    setup({
      rounds: [
        { toolCalls: [call('sd_list_tickets', { bad: true })] },
        { text: 'ok' },
      ],
    })
    await executeSteelAgentRun('run1')
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'TOOL',
        status: 'FAILED',
        error: 'Inválido',
      }),
    )
  })

  it('should execute AUTO writes and log them in AiActionLog as AGENT', async () => {
    let context: unknown
    createExecute.mockImplementation(async () => {
      context = currentSteelAgentContext()
      return ok({
        data: { id: 'task1' },
        summary: 'Tarefa criada',
        target: { type: 'crm_task', id: 'task1' },
      })
    })
    setup({
      tools: [{ toolName: 'crm_create_task', mode: 'AUTO' }],
      rounds: [
        { toolCalls: [call('crm_create_task', { title: 'Ligar' })] },
        { text: 'Feito.' },
      ],
    })

    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    expect(createExecute).toHaveBeenCalled()
    expect(context).toEqual({ agentId: 'agent1', runId: 'run1' })
    expect(pending.create).not.toHaveBeenCalled()
    expect(logs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'AGENT',
        actorId: null,
        agentId: 'agent1',
        toolName: 'crm_create_task',
        targetType: 'crm_task',
        targetId: 'task1',
        outcome: 'success',
        summary: 'Tarefa criada',
        error: null,
      }),
    )
  })

  it('should log a failing AUTO write with its error', async () => {
    createExecute.mockResolvedValue(err(forbidden()))
    logs.create.mockResolvedValue(err(databaseError('x')))
    setup({
      tools: [{ toolName: 'crm_create_task', mode: 'AUTO' }],
      rounds: [{ toolCalls: [call('crm_create_task')] }, { text: 'Não deu.' }],
    })
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    expect(logs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        summary: null,
        targetId: null,
      }),
    )
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'TOOL', status: 'FAILED' }),
    )
  })

  it('should turn APPROVAL writes into pending actions, pause and notify', async () => {
    const { fake } = setup({
      tools: [{ toolName: 'crm_create_task', mode: 'APPROVAL' }],
      rounds: [
        {
          text: 'Vou criar.',
          toolCalls: [call('crm_create_task', { title: 'Ligar' })],
        },
      ],
    })

    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('waiting')

    expect(createExecute).not.toHaveBeenCalled()
    const created = pending.create.mock.calls[0][0]
    expect(created).toEqual(
      expect.objectContaining({
        agentRunId: 'run1',
        requestedById: null,
        toolCallId: 'call_crm_create_task',
        requiresDoubleConfirm: false,
      }),
    )
    const ttl = created.expiresAt.getTime() - Date.now()
    expect(ttl).toBeGreaterThan(STEEL_AGENT_APPROVAL_TTL_MS - 60_000)
    expect(lastUpdate()).toEqual(
      expect.objectContaining({
        status: 'WAITING_APPROVAL',
        summary: 'Vou criar.',
        state: expect.objectContaining({
          round: 1,
          pendingActionIds: ['act_crm_create_task'],
        }),
      }),
    )
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'APPROVAL',
        status: 'PENDING',
        pendingActionId: 'act_crm_create_task',
      }),
    )
    expect(notifyAgentApprovalRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        agentId: 'agent1',
        ownerId: 'owner1',
        runId: 'run1',
        count: 1,
      }),
    )
    expect(fake.chat).toHaveBeenCalledTimes(1)
    expect(usage.record).toHaveBeenCalled()
  })

  it('should force DELETE tools to approval even when configured AUTO', async () => {
    setup({
      tools: [{ toolName: 'crm_delete_task', mode: 'AUTO' }],
      rounds: [{ toolCalls: [call('crm_delete_task', { id: 't1' })] }],
    })

    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('waiting')
    expect(deleteExecute).not.toHaveBeenCalled()
    expect(pending.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'DELETE', requiresDoubleConfirm: true }),
    )
  })

  it('should default to approval when a write has no saved mode', async () => {
    setup({
      tools: [{ toolName: 'crm_create_task', mode: 'APPROVAL' }],
      rounds: [{ toolCalls: [call('crm_create_task')] }],
    })
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('waiting')
  })

  it('should answer a failed proposal back to the model', async () => {
    const { fake } = setup({
      tools: [{ toolName: 'crm_create_task', mode: 'APPROVAL' }],
      rounds: [
        { toolCalls: [call('crm_create_task')] },
        { text: 'Não consegui.' },
      ],
    })
    pending.create.mockResolvedValue(err(databaseError('boom')))

    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    const toolMessage = fake.requests[1].messages.find((m) => m.role === 'tool')
    expect(
      toolMessage && 'content' in toolMessage && toolMessage.content,
    ).toContain('DATABASE_ERROR')
  })

  it('should refuse tools the agent is not allowed to call', async () => {
    const { fake } = setup({
      rounds: [{ toolCalls: [call('crm_create_task')] }, { text: 'ok' }],
    })
    await executeSteelAgentRun('run1')
    expect(createExecute).not.toHaveBeenCalled()
    const toolMessage = fake.requests[1].messages.find((m) => m.role === 'tool')
    expect(JSON.stringify(toolMessage)).toContain('AI_TOOL_NOT_ALLOWED')
  })

  it('should stop at maxToolRounds forcing a text answer', async () => {
    const { fake } = setup({
      agent: { maxToolRounds: 2 },
      rounds: [
        { toolCalls: [call('sd_list_tickets')] },
        { text: 'Resumo final', toolCalls: [call('sd_list_tickets')] },
      ],
    })

    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    expect(fake.chat).toHaveBeenCalledTimes(2)
    expect(fake.requests[0].toolChoice).toBe('auto')
    expect(fake.requests[1].toolChoice).toBe('none')
    expect(readExecute).toHaveBeenCalledTimes(1)
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'TOOL',
        status: 'FAILED',
        error: expect.stringContaining('Limite'),
      }),
    )
    expect(lastUpdate()).toEqual(
      expect.objectContaining({ summary: 'Resumo final' }),
    )
  })

  it('should send no tools when none are available and use a fallback summary', async () => {
    const { fake } = setup({ tools: [], rounds: [{ text: '' }] })
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    expect(fake.requests[0].tools).toBeUndefined()
    expect(lastUpdate()).toEqual(
      expect.objectContaining({
        summary: 'Execução concluída sem resposta do modelo.',
      }),
    )
  })

  it('should keep going when a step cannot be stored', async () => {
    setup({ rounds: [{ text: 'ok' }] })
    steps.create.mockResolvedValue(err(databaseError('x')))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
  })

  it('should fall back to generic names when workspace/owner lookups fail', async () => {
    const { fake } = setup({ rounds: [{ text: 'ok' }] })
    vi.mocked(UserRepository.findById).mockResolvedValue(err(notFound('User')))
    vi.mocked(WorkspaceRepository.findById).mockResolvedValue(
      err(notFound('Workspace')),
    )
    await executeSteelAgentRun('run1')
    expect(fake.requests[0].system).toContain('Responsável')
  })
})

describe('executeSteelAgentRun — triggers', () => {
  it('should describe schedule and event triggers to the model', async () => {
    const schedule = setup({
      run: {
        triggerType: 'SCHEDULE',
        triggerPayload: { scheduledFor: '2026-10-06T11:00:00.000Z' },
      },
      rounds: [{ text: 'ok' }],
    })
    await executeSteelAgentRun('run1')
    expect(JSON.stringify(schedule.fake.requests[0].messages[0])).toContain(
      'agendada',
    )

    const event = setup({
      run: {
        triggerType: 'EVENT',
        triggerPayload: { event: 'sd.ticket.created', ticketId: 't1' },
      },
      agent: { triggerType: 'EVENT', eventKey: 'sd.ticket.created' },
      rounds: [{ text: 'ok' }],
    })
    await executeSteelAgentRun('run1')
    const first = JSON.stringify(event.fake.requests[0].messages[0])
    expect(first).toContain('Chamado aberto')
    expect(first).toContain('t1')
  })
})

describe('executeSteelAgentRun — kill switches', () => {
  it('should skip a paused agent without calling the model', async () => {
    const { fake } = setup({ agent: { enabled: false } })
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('skipped')
    expect(fake.chat).not.toHaveBeenCalled()
    expect(runs.claim).toHaveBeenCalledWith(
      'run1',
      ['QUEUED'],
      expect.objectContaining({
        status: 'SKIPPED',
        summary: 'O agente está pausado.',
      }),
    )
  })

  it('should skip when the agent has no owner', async () => {
    setup({ agent: { ownerId: null } })
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('skipped')
  })

  it('should skip when the owner left the workspace', async () => {
    setup()
    access.mockResolvedValue(err(forbidden()))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('skipped')
    expect(runs.claim).toHaveBeenCalledWith(
      'run1',
      ['QUEUED'],
      expect.objectContaining({
        summary: expect.stringContaining('não é mais membro'),
      }),
    )
  })

  it('should skip when the workspace is suspended', async () => {
    setup()
    access.mockResolvedValue(err(workspaceSuspended()))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('skipped')
  })

  it('should fail (and notify) when access cannot be resolved', async () => {
    setup()
    access.mockResolvedValue(err(databaseError('db down')))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('failed')
    expect(runs.claim).toHaveBeenCalledWith(
      'run1',
      ['QUEUED'],
      expect.objectContaining({ status: 'FAILED', error: 'db down' }),
    )
    expect(notifyAgentRunFailed).toHaveBeenCalled()
  })

  it('should skip when agent mode is off and the agent has write tools', async () => {
    setup({ tools: [{ toolName: 'crm_create_task', mode: 'AUTO' }] })
    access.mockResolvedValue(ok({ ...ACCESS, agentModeEnabled: false }))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('skipped')
  })

  it('should skip when the AI or the Steel Agents switch is off', async () => {
    setup({ rounds: [{ text: 'ok' }] })
    access.mockResolvedValue(ok({ ...ACCESS, aiEnabled: false }))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('skipped')

    setup({ rounds: [{ text: 'ok' }] })
    access.mockResolvedValue(ok({ ...ACCESS, agentsEnabled: false }))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('skipped')
    expect(usage.prepare).not.toHaveBeenCalled()
  })

  it('should still run read-only agents when agent mode is off', async () => {
    setup({ rounds: [{ text: 'ok' }] })
    access.mockResolvedValue(ok({ ...ACCESS, agentModeEnabled: false }))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
  })

  it('should skip on quota exceeded and missing provider', async () => {
    setup()
    usage.prepare.mockResolvedValue(err(aiQuotaExceeded(50, 50)))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('skipped')

    setup()
    usage.prepare.mockResolvedValue(err(aiProviderUnavailable()))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('skipped')

    setup()
    usage.prepare.mockResolvedValue(err(databaseError('x')))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('failed')
  })

  it('should skip when the monthly run cap is reached', async () => {
    setup({ agent: { monthlyRunCap: 3 } })
    runs.countSince.mockResolvedValue(ok(4))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('skipped')

    setup({ agent: { monthlyRunCap: 3 }, rounds: [{ text: 'ok' }] })
    runs.countSince.mockResolvedValue(ok(3))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')

    setup({ agent: { monthlyRunCap: 3 } })
    runs.countSince.mockResolvedValue(err(databaseError('x')))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('failed')
  })

  it('should not notify when another runner already finished it', async () => {
    setup()
    access.mockResolvedValue(err(databaseError('x')))
    runs.claim.mockResolvedValue(ok(false))
    await executeSteelAgentRun('run1')
    expect(notifyAgentRunFailed).not.toHaveBeenCalled()

    setup()
    access.mockResolvedValue(err(databaseError('x')))
    runs.claim.mockResolvedValue(err(databaseError('x')))
    await executeSteelAgentRun('run1')
    expect(notifyAgentRunFailed).not.toHaveBeenCalled()
  })
})

describe('executeSteelAgentRun — lifecycle', () => {
  it('should propagate a load error', async () => {
    setup()
    runs.findForExecution.mockResolvedValue(err(databaseError('x')))
    expectErr(await executeSteelAgentRun('run1'), 'DATABASE_ERROR')
  })

  it('should do nothing for finished runs or a lost claim', async () => {
    setup({ run: { status: 'SUCCEEDED' } })
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('noop')

    setup()
    runs.claim.mockResolvedValue(ok(false))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('noop')

    setup()
    runs.claim.mockResolvedValue(err(databaseError('x')))
    expectErr(await executeSteelAgentRun('run1'), 'DATABASE_ERROR')
  })

  it('should fail and notify when the provider throws', async () => {
    setup({ rounds: [new Error('timeout')] })
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('failed')
    expect(lastUpdate()).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        error: expect.stringContaining('timeout'),
      }),
    )
    expect(notifyAgentRunFailed).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run1', ownerId: 'owner1' }),
    )
  })

  it('should treat a non-Error throw as a failure too', async () => {
    setup()
    usage.prepare.mockResolvedValue(
      ok(
        prepared({
          id: 'openai',
          chat: vi.fn(async () => {
            throw 'boom'
          }),
          chatStream: vi.fn(),
        } as unknown as AiProvider),
      ),
    )
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('failed')
  })

  it('should return an error when the final save fails', async () => {
    setup({ rounds: [{ text: 'ok' }] })
    runs.update.mockResolvedValue(err(databaseError('x')))
    expectErr(await executeSteelAgentRun('run1'), 'DATABASE_ERROR')
  })

  it('should stay waiting while an approval is still pending', async () => {
    setup({ run: { status: 'WAITING_APPROVAL' } })
    runs.listActions.mockResolvedValue(
      ok([
        createFakeAiPendingAction({ status: 'PENDING', agentRunId: 'run1' }),
      ]),
    )
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('waiting')
    expect(runs.claim).not.toHaveBeenCalled()
  })

  it('should propagate errors listing actions of a waiting run', async () => {
    setup({ run: { status: 'WAITING_APPROVAL' } })
    runs.listActions.mockResolvedValue(err(databaseError('x')))
    expectErr(await executeSteelAgentRun('run1'), 'DATABASE_ERROR')

    setup({ run: { status: 'WAITING_APPROVAL' } })
    runs.listActions
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await executeSteelAgentRun('run1'), 'DATABASE_ERROR')
  })

  it('should resume after the decisions with the stored transcript', async () => {
    const executed = createFakeAiPendingAction({
      id: 'a1',
      agentRunId: 'run1',
      status: 'EXECUTED',
      preview: { title: 'Criar tarefa “Ligar”', summary: '' },
      result: { summary: 'Tarefa criada' },
    })
    const rejected = createFakeAiPendingAction({
      id: 'a2',
      agentRunId: 'run1',
      status: 'CANCELED',
      preview: { title: 'Excluir tarefa', summary: '' },
    })
    const failed = createFakeAiPendingAction({
      id: 'a3',
      agentRunId: 'run1',
      status: 'FAILED',
      error: 'Sem permissão',
      preview: { title: 'Mover chamado', summary: '' },
    })
    const expired = createFakeAiPendingAction({
      id: 'a4',
      agentRunId: 'run1',
      status: 'EXPIRED',
      preview: { title: 'Enviar mensagem', summary: '' },
    })
    const older = createFakeAiPendingAction({ id: 'old', status: 'EXECUTED' })
    const { fake } = setup({
      run: {
        status: 'WAITING_APPROVAL',
        state: {
          messages: [{ role: 'user', content: 'início' }],
          round: 3,
          pendingActionIds: ['a1', 'a2', 'a3', 'a4'],
        },
      },
      rounds: [{ text: 'Tudo certo.' }],
    })
    runs.listActions.mockResolvedValue(
      ok([older, executed, rejected, failed, expired]),
    )

    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    expect(runs.claim).toHaveBeenCalledWith(
      'run1',
      ['WAITING_APPROVAL'],
      expect.not.objectContaining({ startedAt: expect.anything() }),
    )
    const messages = fake.requests[0].messages
    expect(messages[0]).toEqual({ role: 'user', content: 'início' })
    const note = (messages[1] as { content: string }).content
    expect(note).toContain(
      'Criar tarefa “Ligar”: aprovada e executada. Resultado: Tarefa criada',
    )
    expect(note).toContain('Excluir tarefa: rejeitada')
    expect(note).toContain(
      'Mover chamado: aprovada, mas a execução falhou: Sem permissão',
    )
    expect(note).toContain('Enviar mensagem: expirou')
    expect(note).not.toContain('old')
    expect(lastUpdate()).toEqual(
      expect.objectContaining({
        status: 'SUCCEEDED',
        rounds: { increment: 1 },
      }),
    )
  })

  it('should resume from an empty state too', async () => {
    const { fake } = setup({
      run: { status: 'WAITING_APPROVAL', state: null },
      rounds: [{ text: 'ok' }],
    })
    runs.listActions.mockResolvedValue(
      ok([
        createFakeAiPendingAction({
          status: 'FAILED',
          error: null,
          preview: null as never,
          toolName: 'crm_create_task',
        }),
      ]),
    )
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    expect(JSON.stringify(fake.requests[0].messages)).toContain(
      'crm_create_task: aprovada, mas a execução falhou.',
    )
  })
})

describe('executeSteelAgentRun — test runs ("Testar agente")', () => {
  const TOOLS = [
    { toolName: 'sd_list_tickets', mode: 'APPROVAL' as const },
    { toolName: 'crm_create_task', mode: 'AUTO' as const },
    { toolName: 'crm_delete_task', mode: 'APPROVAL' as const },
  ]

  it('should simulate AUTO and APPROVAL writes and never execute them', async () => {
    setup({
      run: { isTest: true, startedById: 'tester1' },
      tools: TOOLS,
      rounds: [
        {
          toolCalls: [
            call('sd_list_tickets'),
            call('crm_create_task', { title: 'Ligar' }),
            call('crm_delete_task', { id: 'task9' }),
          ],
        },
        { text: 'Eu criaria uma tarefa e excluiria outra.' },
      ],
    })

    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')

    expect(readExecute).toHaveBeenCalled()
    expect(createExecute).not.toHaveBeenCalled()
    expect(deleteExecute).not.toHaveBeenCalled()
    expect(pending.create).not.toHaveBeenCalled()
    expect(notifyAgentApprovalRequested).not.toHaveBeenCalled()
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'TOOL',
        toolName: 'crm_create_task',
        status: 'SIMULATED',
        output: {
          title: 'Criar tarefa “Ligar”',
          simulation: {
            kind: 'CREATE',
            preview: { title: 'Criar tarefa “Ligar”', summary: 'Ligar' },
          },
        },
      }),
    )
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'crm_delete_task',
        status: 'SIMULATED',
      }),
    )
    expect(logs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'AGENT',
        agentId: 'agent1',
        actorId: 'tester1',
        outcome: 'simulated',
      }),
    )
    expect(lastUpdate()).toEqual(
      expect.objectContaining({
        status: 'SUCCEEDED',
        summary: 'Eu criaria uma tarefa e excluiria outra.',
      }),
    )
    expect(usage.record).toHaveBeenCalled()
  })

  it('should record a failed simulation as a FAILED step', async () => {
    setup({
      run: { isTest: true },
      tools: TOOLS,
      rounds: [{ toolCalls: [call('crm_create_task')] }, { text: 'Ok.' }],
    })
    const original = createTool.preview
    createTool.preview = async () => err(validationError('Sem título'))
    try {
      expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    } finally {
      createTool.preview = original
    }
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'crm_create_task',
        status: 'FAILED',
        error: 'Sem título',
      }),
    )
    expect(createExecute).not.toHaveBeenCalled()
  })

  it('should run a paused agent, with the agent mode off and over the monthly cap', async () => {
    setup({
      run: { isTest: true },
      agent: { enabled: false, monthlyRunCap: 1 },
      tools: TOOLS,
      rounds: [{ text: 'Nada a fazer.' }],
    })
    access.mockResolvedValue(ok({ ...ACCESS, agentModeEnabled: false }))
    runs.countSince.mockResolvedValue(ok(5))

    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    expect(runs.countSince).not.toHaveBeenCalled()
  })

  it('should not notify anyone when a test run fails', async () => {
    setup({
      run: { isTest: true },
      rounds: [new Error('provider down')],
    })
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('failed')
    expect(notifyAgentRunFailed).not.toHaveBeenCalled()

    setup({ run: { isTest: true } })
    access.mockResolvedValue(err(databaseError('db down')))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('failed')
    expect(notifyAgentRunFailed).not.toHaveBeenCalled()
  })
})

describe('executeSteelAgentRun() — prompt injection (ADR 0041)', () => {
  it('should turn an AUTO write into an approval once the run saw an injection', async () => {
    const { fake } = setup({
      tools: [{ toolName: 'crm_create_task', mode: 'AUTO' }],
      rounds: [
        { toolCalls: [call('crm_create_task', { title: 'Ligar' })] },
        { text: 'Aguardando aprovação.' },
      ],
    })
    usage.prepare.mockResolvedValue(
      ok({
        ...prepared(fake.provider),
        guard: {
          report: {
            piiCounts: { EMAIL: 0, CNPJ: 0, CPF: 0, CARD: 0, PHONE: 0 },
            injection: {
              detected: true,
              signals: ['fake_role_tag'],
              sources: ['tool_result'],
            },
            failovers: [],
          },
          tainted: () => true,
        },
      }),
    )

    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('waiting')
    expect(createExecute).not.toHaveBeenCalled()
    expect(pending.create).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'crm_create_task' }),
    )
  })
})

describe('executeSteelAgentRun() — trace (A4: the "why" of a run)', () => {
  const stepsOf = (kind: string) =>
    steps.create.mock.calls
      .map(([data]) => data)
      .filter((data) => data.kind === kind)

  it('should record the round, the model and the retrieved context', async () => {
    setup({
      rounds: [
        { text: 'Vou consultar.', toolCalls: [call('sd_list_tickets')] },
        { text: 'Há 1 chamado.' },
      ],
    })
    readExecute.mockResolvedValue(
      ok({ data: [{ id: 't1' }], summary: '1 chamado' }),
    )
    await executeSteelAgentRun('run1')

    const models = stepsOf('MODEL')
    expect(models[0].output).toEqual(
      expect.objectContaining({
        round: 1,
        modelKey: 'openai:gpt-4o-mini',
        text: 'Vou consultar.',
        toolCalls: ['sd_list_tickets'],
      }),
    )
    expect(models[1].output).toEqual(expect.objectContaining({ round: 2 }))
    const tool = stepsOf('TOOL')[0]
    expect(tool.output).toEqual({
      summary: '1 chamado',
      context: {
        excerpt: expect.stringContaining('t1'),
        truncated: false,
      },
    })
    expect(stepsOf('GUARDRAIL')).toHaveLength(0)
  })

  it('should cut a long retrieved context', async () => {
    setup({
      rounds: [{ toolCalls: [call('sd_list_tickets')] }, { text: 'ok' }],
    })
    readExecute.mockResolvedValue(
      ok({ data: 'x'.repeat(5_000), summary: 'grande' }),
    )
    await executeSteelAgentRun('run1')
    const output = stepsOf('TOOL')[0].output as {
      context: { excerpt: string; truncated: boolean }
    }
    expect(output.context.truncated).toBe(true)
    expect(output.context.excerpt).toHaveLength(2_000)
  })

  it('should record the guardrails the call guard applied', async () => {
    const { fake } = setup({
      rounds: [{ toolCalls: [call('sd_list_tickets')] }, { text: 'ok' }],
    })
    const report = {
      piiCounts: { EMAIL: 0, CNPJ: 0, CPF: 0, CARD: 0, PHONE: 0 },
      injection: {
        detected: false,
        signals: [] as string[],
        sources: [] as string[],
      },
      failovers: [] as { from: string; to: string; reason: string }[],
    }
    usage.prepare.mockResolvedValue(
      ok({
        ...prepared(fake.provider),
        guard: { report, tainted: () => false },
      }),
    )
    // The guard works inside the provider call: mutate the report there.
    fake.chat.mockImplementationOnce(async () => {
      report.piiCounts.CPF = 2
      report.failovers.push({ from: 'a', to: 'b', reason: 'timeout' })
      return response({ toolCalls: [call('sd_list_tickets')] })
    })
    fake.chat.mockImplementationOnce(async () => {
      report.injection.detected = true
      report.injection.sources.push('tool_result')
      report.injection.signals.push('fake_role_tag')
      return response({ text: 'ok' })
    })
    await executeSteelAgentRun('run1')

    const rules = stepsOf('GUARDRAIL').map(
      (s) => (s.output as { rule: string }).rule,
    )
    expect(rules).toEqual(['PII_MASKED', 'MODEL_FAILOVER', 'PROMPT_INJECTION'])
    expect(stepsOf('GUARDRAIL')[0].output).toEqual(
      expect.objectContaining({
        counts: { CPF: 2 },
        title: 'Dados pessoais mascarados',
      }),
    )
  })

  it('should record why a write went to approval instead of running', async () => {
    const { fake } = setup({
      tools: [{ toolName: 'crm_create_task', mode: 'AUTO' }],
      rounds: [{ toolCalls: [call('crm_create_task')] }, { text: 'ok' }],
    })
    usage.prepare.mockResolvedValue(
      ok({
        ...prepared(fake.provider),
        guard: {
          report: {
            piiCounts: { EMAIL: 0, CNPJ: 0, CPF: 0, CARD: 0, PHONE: 0 },
            injection: { detected: true, signals: [], sources: [] },
            failovers: [],
          },
          tainted: () => true,
        },
      }),
    )
    await executeSteelAgentRun('run1')
    expect(stepsOf('GUARDRAIL')).toEqual([
      expect.objectContaining({
        toolName: 'crm_create_task',
        output: expect.objectContaining({ rule: 'AUTO_NEEDS_APPROVAL' }),
      }),
    ])
  })

  it('should record the delete rule and a disallowed tool', async () => {
    setup({
      tools: [{ toolName: 'crm_delete_task', mode: 'AUTO' }],
      rounds: [
        {
          toolCalls: [
            call('crm_delete_task'),
            { id: 'x', name: 'crm_create_task', arguments: {} },
          ],
        },
      ],
    })
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('waiting')
    const rules = stepsOf('GUARDRAIL').map(
      (s) => (s.output as { rule: string }).rule,
    )
    expect(rules).toEqual(['DELETE_NEEDS_APPROVAL', 'TOOL_NOT_ALLOWED'])
  })

  it('should record the round limit rule', async () => {
    setup({
      agent: { maxToolRounds: 1 },
      rounds: [{ toolCalls: [call('sd_list_tickets')] }],
    })
    await executeSteelAgentRun('run1')
    expect(stepsOf('GUARDRAIL')).toEqual([
      expect.objectContaining({
        toolName: 'sd_list_tickets',
        output: expect.objectContaining({
          rule: 'ROUND_LIMIT',
          maxToolRounds: 1,
        }),
      }),
    ])
  })
})

describe('executeSteelAgentRun — versions (A/B)', () => {
  const versions = vi.mocked(SteelAgentVersionRepository)
  const challenger = createFakeSteelAgentVersion({
    id: 'v2',
    agentId: 'agent1',
    number: 2,
    status: 'CHALLENGER',
    rolloutPercent: 50,
    instructions: 'Instruções da versão desafiante.',
    maxToolRounds: 3,
    tools: [{ toolName: 'sd_list_tickets', mode: 'AUTO' }],
  })

  beforeEach(() => {
    versions.findByIdUnscoped.mockResolvedValue(ok(challenger))
  })

  it('should record the published version on a new run and use the agent as it is', async () => {
    const { fake } = setup({
      agent: { publishedVersionId: 'v1' },
      rounds: [{ text: 'Ok.' }],
    })
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    expect(runs.update).toHaveBeenCalledWith('run1', { versionId: 'v1' })
    expect(versions.findByIdUnscoped).not.toHaveBeenCalled()
    expect(fake.requests[0].system).toContain('Classifique cada chamado novo.')
  })

  it('should send the challenger share of runs to the challenger snapshot', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const { fake } = setup({
      agent: { publishedVersionId: 'v1', challengerVersionId: 'v2' },
      rounds: [{ text: 'Ok.' }],
    })
    expectOk(await executeSteelAgentRun('run1'))
    random.mockRestore()
    expect(runs.update).toHaveBeenCalledWith('run1', { versionId: 'v2' })
    expect(fake.requests[0].system).toContain(
      'Instruções da versão desafiante.',
    )
    expect(fake.requests[0].tools?.map((t) => t.name)).toEqual([
      'sd_list_tickets',
    ])
  })

  it('should keep the rest of the runs on the published version', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const { fake } = setup({
      agent: { publishedVersionId: 'v1', challengerVersionId: 'v2' },
      rounds: [{ text: 'Ok.' }],
    })
    expectOk(await executeSteelAgentRun('run1'))
    random.mockRestore()
    expect(runs.update).toHaveBeenCalledWith('run1', { versionId: 'v1' })
    expect(fake.requests[0].system).not.toContain(
      'Instruções da versão desafiante.',
    )
  })

  it('should ignore a challenger pointer that is no longer a live experiment', async () => {
    versions.findByIdUnscoped.mockResolvedValue(
      ok({ ...challenger, status: 'DISCARDED' }),
    )
    setup({
      agent: { publishedVersionId: 'v1', challengerVersionId: 'v2' },
      rounds: [{ text: 'Ok.' }],
    })
    expectOk(await executeSteelAgentRun('run1'))
    expect(runs.update).toHaveBeenCalledWith('run1', { versionId: 'v1' })

    versions.findByIdUnscoped.mockResolvedValue(ok(null))
    setup({
      agent: { publishedVersionId: 'v1', challengerVersionId: 'v2' },
      rounds: [{ text: 'Ok.' }],
    })
    expectOk(await executeSteelAgentRun('run1'))

    versions.findByIdUnscoped.mockResolvedValue(err(databaseError('x')))
    setup({
      agent: { publishedVersionId: 'v1', challengerVersionId: 'v2' },
      rounds: [{ text: 'Ok.' }],
    })
    expectOk(await executeSteelAgentRun('run1'))
  })

  it('should keep the version already recorded on the run', async () => {
    const { fake } = setup({
      run: { versionId: 'v2' },
      agent: { publishedVersionId: 'v1' },
      rounds: [{ text: 'Ok.' }],
    })
    expectOk(await executeSteelAgentRun('run1'))
    expect(runs.update).not.toHaveBeenCalledWith('run1', {
      versionId: expect.anything(),
    })
    expect(fake.requests[0].system).toContain(
      'Instruções da versão desafiante.',
    )
  })

  it('should fall back to the agent when the recorded version is gone', async () => {
    versions.findByIdUnscoped.mockResolvedValue(ok(null))
    const { fake } = setup({
      run: { versionId: 'gone' },
      rounds: [{ text: 'Ok.' }],
    })
    expectOk(await executeSteelAgentRun('run1'))
    expect(fake.requests[0].system).toContain('Classifique cada chamado novo.')
  })

  it('should not assign a version to test runs', async () => {
    setup({
      run: { isTest: true },
      agent: { publishedVersionId: 'v1', challengerVersionId: 'v2' },
      rounds: [{ text: 'Ok.' }],
    })
    expectOk(await executeSteelAgentRun('run1'))
    expect(runs.update).not.toHaveBeenCalledWith('run1', {
      versionId: expect.anything(),
    })
  })
})

describe('executeSteelAgentRun — emergency switch (A6)', () => {
  const killed = () =>
    ok(
      createFakeSteelAgentPolicy({
        killedAt: new Date('2026-10-30T10:00:00Z'),
      }),
    )

  it('should skip a run that starts while the switch is on', async () => {
    setup()
    vi.mocked(SteelAgentPolicyRepository).find.mockResolvedValue(killed())
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('skipped')
    expect(runs.claim).toHaveBeenCalledWith(
      'run1',
      ['QUEUED'],
      expect.objectContaining({
        status: 'SKIPPED',
        summary: expect.stringContaining('pausados por emergência'),
      }),
    )
  })

  it('should still let a test run go through', async () => {
    setup({ run: { isTest: true }, rounds: [{ text: 'Simulado.' }] })
    vi.mocked(SteelAgentPolicyRepository).find.mockResolvedValue(killed())
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
  })

  it('should fail the run when the policy cannot be read', async () => {
    setup()
    vi.mocked(SteelAgentPolicyRepository).find.mockResolvedValue(
      err(databaseError('x')),
    )
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('failed')
  })

  it('should stop a running agent between rounds when the switch turns on', async () => {
    setup({
      rounds: [
        { toolCalls: [call('sd_list_tickets')] },
        { text: 'não deveria chegar aqui' },
      ],
    })
    vi.mocked(SteelAgentPolicyRepository)
      .find.mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(killed())
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('skipped')
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'GUARDRAIL',
        output: expect.objectContaining({ rule: 'KILL_SWITCH' }),
      }),
    )
    expect(lastUpdate()).toEqual(
      expect.objectContaining({ status: 'SKIPPED', rounds: { increment: 1 } }),
    )
  })
})

describe('executeSteelAgentRun — AUTO by role (A8)', () => {
  const restricted = (mode: 'NONE' | 'LIST', tools: string[] = []) =>
    ok(
      createFakeSteelAgentPolicy({
        restrictAuto: true,
        autoRules: {
          ADMIN: { mode, tools },
          MEMBER: { mode, tools },
          VIEWER: { mode, tools },
        },
      }),
    )

  it('should send an AUTO write to approval when the owner role is not allowed', async () => {
    setup({
      tools: [{ toolName: 'crm_create_task', mode: 'AUTO' }],
      rounds: [{ toolCalls: [call('crm_create_task')] }],
    })
    vi.mocked(SteelAgentPolicyRepository).find.mockResolvedValue(
      restricted('NONE'),
    )
    vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
      ok(createFakeMembership({ role: 'MEMBER' }) as never),
    )
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('waiting')
    expect(createExecute).not.toHaveBeenCalled()
    expect(pending.create).toHaveBeenCalled()
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'GUARDRAIL',
        output: expect.objectContaining({ rule: 'AUTO_ROLE_RESTRICTED' }),
      }),
    )
  })

  it('should keep AUTO when the role has the tool listed', async () => {
    setup({
      tools: [{ toolName: 'crm_create_task', mode: 'AUTO' }],
      rounds: [{ toolCalls: [call('crm_create_task')] }, { text: 'Feito.' }],
    })
    vi.mocked(SteelAgentPolicyRepository).find.mockResolvedValue(
      restricted('LIST', ['crm_create_task']),
    )
    vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
      ok(createFakeMembership({ role: 'ADMIN' }) as never),
    )
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    expect(createExecute).toHaveBeenCalled()
  })

  it('should treat an owner without membership as the most restricted role', async () => {
    setup({
      tools: [{ toolName: 'crm_create_task', mode: 'AUTO' }],
      rounds: [{ toolCalls: [call('crm_create_task')] }],
    })
    vi.mocked(SteelAgentPolicyRepository).find.mockResolvedValue(
      restricted('NONE'),
    )
    vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
      ok(null),
    )
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('waiting')
  })

  it('should fail when the owner membership cannot be loaded', async () => {
    setup()
    vi.mocked(SteelAgentPolicyRepository).find.mockResolvedValue(
      restricted('NONE'),
    )
    vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
      err(databaseError('x')),
    )
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('failed')
  })
})

describe('executeSteelAgentRun — external MCP tools (A8)', () => {
  const server = createFakeSteelMcpServer({
    workspaceId: 'ws1',
    allowedTools: ['list_issues', 'create_issue'],
  })

  it('should offer an allow-listed MCP tool and run a read through the server', async () => {
    vi.mocked(SteelMcpServerRepository).listByWorkspace.mockResolvedValue(
      ok([server]),
    )
    vi.mocked(SteelMcpServerRepository).findById.mockResolvedValue(ok(server))
    vi.mocked(callMcpTool).mockResolvedValue(
      ok({ text: '3 issues abertas', isError: false }),
    )
    const { fake } = setup({
      tools: [{ toolName: 'mcp_github__list_issues', mode: 'APPROVAL' }],
      rounds: [
        { toolCalls: [call('mcp_github__list_issues', { repo: 'a/b' })] },
        { text: 'Há 3 issues.' },
      ],
    })
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    expect(fake.requests[0].tools?.map((t) => t.name)).toEqual([
      'mcp_github__list_issues',
    ])
    expect(callMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({ url: server.url }),
      'list_issues',
      { repo: 'a/b' },
    )
  })

  it('should send an MCP write to approval instead of running it', async () => {
    vi.mocked(SteelMcpServerRepository).listByWorkspace.mockResolvedValue(
      ok([server]),
    )
    setup({
      tools: [{ toolName: 'mcp_github__create_issue', mode: 'APPROVAL' }],
      rounds: [
        { toolCalls: [call('mcp_github__create_issue', { title: 'Bug' })] },
      ],
    })
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('waiting')
    expect(callMcpTool).not.toHaveBeenCalled()
    expect(pending.create).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'mcp_github__create_issue' }),
    )
  })

  it('should fail the run when the MCP tools cannot be loaded', async () => {
    vi.mocked(SteelMcpServerRepository).listByWorkspace.mockResolvedValue(
      err(databaseError('x')),
    )
    setup()
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('failed')
  })
})

describe('executeSteelAgentRun — delegation (A7)', () => {
  const target = {
    id: 'agent2',
    name: 'Especialista CRM',
    description: 'Cuida do funil',
    enabled: true,
  }

  /** Parent run1 (agent1) delegating to child1 (agent2). */
  function delegating(
    rounds: (Partial<AiChatResponse> | Error)[],
    options: {
      childFinal?: Partial<ReturnType<typeof childRun>>
      childOutcome?: Run
      runDepth?: number
    } = {},
  ) {
    const { run, fake } = setup({
      rounds,
      run: { depth: options.runDepth ?? 0 },
    })
    const queued = childRun({ status: 'QUEUED' })
    const final = childRun({
      status: 'SUCCEEDED',
      summary: 'Lead qualificado.',
      costUsd: new Prisma.Decimal(0.5),
      ...options.childFinal,
    })
    let reads = 0
    runs.findForExecution.mockImplementation(async (id) => {
      if (id === 'run1') return ok(run)
      reads++
      return ok(reads === 1 ? queued : final)
    })
    runs.create.mockResolvedValue(ok(queued))
    vi.mocked(SteelAgentDelegateRepository).listTargets.mockImplementation(
      async (id) => ok(id === 'agent1' ? [target] : []),
    )
    return { run, fake }
  }

  function childRun(overrides: Record<string, unknown>) {
    return createFakeSteelAgentRunWithAgent(
      {
        id: 'child1',
        workspaceId: 'ws1',
        parentRunId: 'run1',
        depth: 1,
        triggerPayload: {
          task: 'Qualifique o lead 42',
          delegatedBy: {
            agentId: 'agent1',
            agentName: 'Agente',
            runId: 'run1',
          },
        } as never,
        ...overrides,
      },
      {
        id: 'agent2',
        workspaceId: 'ws1',
        ownerId: 'owner2',
        name: 'Especialista CRM',
        tools: [],
      },
    )
  }

  it('should run the delegated agent inline, sum its cost and report back', async () => {
    const { fake } = delegating([
      {
        toolCalls: [
          call('delegate_to_agent', {
            agentId: 'agent2',
            task: 'Qualifique o lead 42',
          }),
        ],
      },
      { text: 'Delegado e concluído.' },
      { text: 'Tudo certo.' },
    ])

    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')

    expect(fake.requests[0].tools?.map((t) => t.name)).toContain(
      'delegate_to_agent',
    )
    expect(runs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent2',
        parentRunId: 'run1',
        depth: 1,
        isTest: false,
        triggerPayload: expect.objectContaining({
          task: 'Qualifique o lead 42',
        }),
      }),
    )
    // The child's first message is the delegation, not a trigger.
    expect(fake.requests[1].messages[0]).toEqual(
      expect.objectContaining({
        content: expect.stringContaining('Tarefa delegada'),
      }),
    )
    const parentUpdate = runs.update.mock.calls
      .map((c) => c[1] as Record<string, unknown>)
      .filter((u) => u.status === 'SUCCEEDED')
      .at(-1)
    // 0.25 own price + 0.5 delegated, with the delegated part reported apart.
    expect(parentUpdate?.costUsd).toEqual({ increment: 0.75 })
    expect(parentUpdate?.delegatedCostUsd).toEqual({ increment: 0.5 })
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'TOOL',
        toolName: 'delegate_to_agent',
        status: 'OK',
        output: expect.objectContaining({
          childRunId: 'child1',
          childAgentId: 'agent2',
          childStatus: 'SUCCEEDED',
        }),
      }),
    )
  })

  it('should inherit test mode so a delegated write is only simulated', async () => {
    const { run } = setup({
      run: { isTest: true },
      rounds: [
        {
          toolCalls: [
            call('delegate_to_agent', { agentId: 'agent2', task: 't' }),
          ],
        },
        { text: 'ok' },
        { text: 'fim' },
      ],
    })
    let reads = 0
    runs.findForExecution.mockImplementation(async (id) => {
      if (id === 'run1') return ok(run)
      reads++
      return ok(
        childRun({
          status: reads === 1 ? 'QUEUED' : 'SUCCEEDED',
          isTest: true,
        }),
      )
    })
    vi.mocked(SteelAgentDelegateRepository).listTargets.mockImplementation(
      async (id) => ok(id === 'agent1' ? [target] : []),
    )
    runs.create.mockResolvedValue(ok(childRun({ status: 'QUEUED' })))
    await executeSteelAgentRun('run1')
    expect(runs.create).toHaveBeenCalledWith(
      expect.objectContaining({ isTest: true }),
    )
  })

  it('should surface a child that is waiting for approval as done with a note', async () => {
    delegating(
      [
        {
          toolCalls: [
            call('delegate_to_agent', { agentId: 'agent2', task: 't' }),
          ],
        },
        { text: 'Proponho a ação.' },
        { text: 'Aguardando.' },
      ],
      {
        childFinal: {
          status: 'WAITING_APPROVAL',
          summary: 'Proposta pendente',
        },
      },
    )
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'delegate_to_agent',
        status: 'OK',
        output: expect.objectContaining({ childStatus: 'WAITING_APPROVAL' }),
      }),
    )
  })

  it('should report a failed or skipped child as a tool error', async () => {
    delegating(
      [
        {
          toolCalls: [
            call('delegate_to_agent', { agentId: 'agent2', task: 't' }),
          ],
        },
        { text: 'x' },
        { text: 'Não deu.' },
      ],
      {
        childFinal: {
          status: 'SKIPPED',
          summary: null,
          error: null,
          costUsd: new Prisma.Decimal(0),
        },
      },
    )
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'delegate_to_agent',
        status: 'FAILED',
        error: 'A delegação não foi concluída.',
      }),
    )
  })

  it('should refuse invalid args and targets outside the delegate list', async () => {
    delegating([
      { toolCalls: [call('delegate_to_agent', { agentId: 'agent2' })] },
      {
        toolCalls: [
          call('delegate_to_agent', { agentId: 'stranger', task: 't' }),
        ],
      },
      { text: 'Desisti.' },
    ])
    await executeSteelAgentRun('run1')
    expect(runs.create).not.toHaveBeenCalled()
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'GUARDRAIL',
        output: expect.objectContaining({ rule: 'DELEGATION_REFUSED' }),
      }),
    )
  })

  it('should refuse a cycle, a too deep chain and too many delegations', async () => {
    delegating([
      {
        toolCalls: [
          call('delegate_to_agent', { agentId: 'agent2', task: 't' }),
        ],
      },
      { text: 'fim' },
    ])
    vi.mocked(SteelAgentDelegateRepository).runChain.mockResolvedValue(
      ok(['agent2', 'agent1']),
    )
    await executeSteelAgentRun('run1')
    expect(runs.create).not.toHaveBeenCalled()
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        error: expect.stringContaining('ciclo'),
      }),
    )
  })

  it('should not even offer the tool at the maximum depth', async () => {
    const { fake } = delegating([{ text: 'Fim.' }], { runDepth: 3 })
    await executeSteelAgentRun('run1')
    expect(fake.requests[0].tools?.map((t) => t.name)).not.toContain(
      'delegate_to_agent',
    )
    expect(
      vi.mocked(SteelAgentDelegateRepository).listTargets,
    ).not.toHaveBeenCalled()
  })

  it('should cap the delegations of one run', async () => {
    const calls = Array.from({ length: 6 }, (_, i) => ({
      id: `d${i}`,
      name: 'delegate_to_agent',
      arguments: { agentId: 'agent2', task: `t${i}` },
    }))
    const { run } = delegating([{ toolCalls: calls }, { text: 'Fim.' }])
    runs.findForExecution.mockImplementation(async (id) =>
      ok(id === 'run1' ? run : childRun({ status: 'SUCCEEDED' })),
    )
    vi.mocked(SteelAgentDelegateRepository).runChain.mockResolvedValue(
      ok(['agent1']),
    )
    await executeSteelAgentRun('run1')
    expect(runs.create).toHaveBeenCalledTimes(5)
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        error: expect.stringContaining('Limite de 5 delegações'),
      }),
    )
  })

  it('should fail the call when the child run cannot be created', async () => {
    delegating([
      {
        toolCalls: [
          call('delegate_to_agent', { agentId: 'agent2', task: 't' }),
        ],
      },
      { text: 'ok' },
    ])
    runs.create.mockResolvedValue(err(databaseError('x')))
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    expect(steps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'delegate_to_agent',
        status: 'FAILED',
      }),
    )
  })

  it('should fail the run when the delegation targets cannot be loaded', async () => {
    setup()
    vi.mocked(SteelAgentDelegateRepository).listTargets.mockResolvedValue(
      err(databaseError('x')),
    )
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('failed')
  })

  it('should skip paused targets', async () => {
    const { fake } = setup({ rounds: [{ text: 'ok' }] })
    vi.mocked(SteelAgentDelegateRepository).listTargets.mockResolvedValue(
      ok([{ ...target, enabled: false }]),
    )
    await executeSteelAgentRun('run1')
    expect(fake.requests[0].tools?.map((t) => t.name)).not.toContain(
      'delegate_to_agent',
    )
  })

  it('should read the chain failure as a single-agent chain', async () => {
    delegating([
      {
        toolCalls: [
          call('delegate_to_agent', { agentId: 'agent2', task: 't' }),
        ],
      },
      { text: 'ok' },
      { text: 'fim' },
    ])
    vi.mocked(SteelAgentDelegateRepository).runChain.mockResolvedValue(
      err(databaseError('x')),
    )
    expect(expectOk(await executeSteelAgentRun('run1'))).toBe('succeeded')
    expect(runs.create).toHaveBeenCalled()
  })
})
