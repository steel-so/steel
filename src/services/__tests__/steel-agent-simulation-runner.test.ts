import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSimulationForExecution } from '@/src/__tests__/factories/nov-a3-persona-simulation.factory'
import { createFakeSteelAgentTool } from '@/src/__tests__/factories/steel-agent.factory'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  aiProviderUnavailable,
  aiQuotaExceeded,
  databaseError,
  forbidden,
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
    availableTools: vi.fn(
      (access: Parameters<typeof actual.availableTools>[0], mode: 'TEST') =>
        actual.availableTools(access, mode, registry.tools as Tools),
    ),
  }
})
vi.mock('@/src/repositories/steel-agent-simulation.repository')
vi.mock('@/src/repositories/ai-action-log.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/services/ai-usage.service')

import { resolveToolAccess } from '@/src/lib/ai/tools/registry'
import { AiActionLogRepository } from '@/src/repositories/ai-action-log.repository'
import {
  SteelAgentSimulationCaseRepository,
  SteelAgentSimulationRepository,
} from '@/src/repositories/steel-agent-simulation.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import {
  AiUsageService,
  type PreparedAiCall,
} from '@/src/services/ai-usage.service'
import { executeSteelAgentSimulation } from '../steel-agent-simulation-runner'

const access = vi.mocked(resolveToolAccess)
const sims = vi.mocked(SteelAgentSimulationRepository)
const cases = vi.mocked(SteelAgentSimulationCaseRepository)
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
  parse: (args) => (args.bad ? err(validationError('Inválido')) : ok(args)),
  preview: async (_ctx, args) =>
    (args as { fail?: boolean }).fail
      ? err(validationError('Prévia inválida'))
      : ok({ title: 'Criar tarefa “Ligar”', summary: 'Ligar' }),
  execute: createExecute,
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
    usage: { inputTokens: 10, outputTokens: 5 },
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

const customer = (message: string, end = false, reason = '') =>
  JSON.stringify({ message, end, reason })
const judge = (score: number, met: boolean[] = [true, true]) =>
  JSON.stringify({
    score,
    goalAchieved: score >= 70,
    criteria: met.map((value, index) => ({
      criterion: `c${index}`,
      met: value,
      evidence: `ev${index}`,
    })),
    summary: 'Resumo do avaliador',
  })

interface Script {
  agent?: (Partial<AiChatResponse> | Error)[]
  customer?: (Partial<AiChatResponse> | Error)[]
  judge?: (Partial<AiChatResponse> | Error)[]
}

/** One provider; the structured-output name tells which role is asking. */
function fakeProvider(script: Script) {
  const queues = {
    agent: [...(script.agent ?? [])],
    customer: [...(script.customer ?? [])],
    judge: [...(script.judge ?? [])],
  }
  const requests = { agent: [], customer: [], judge: [] } as Record<
    'agent' | 'customer' | 'judge',
    AiChatRequest[]
  >
  const chat = vi.fn(async (request: AiChatRequest) => {
    const role =
      request.jsonSchema?.name === 'simulation_customer_turn'
        ? 'customer'
        : request.jsonSchema?.name === 'simulation_judgement'
          ? 'judge'
          : 'agent'
    requests[role].push(structuredClone(request))
    const next = queues[role].shift() ?? { text: 'Pronto.' }
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

function setup(
  options: {
    script?: Script
    simulation?: Parameters<typeof createFakeSimulationForExecution>[0]
    cases?: Parameters<typeof createFakeSimulationForExecution>[1]
    agent?: Parameters<typeof createFakeSimulationForExecution>[2]
    tools?: string[]
  } = {},
) {
  const fake = fakeProvider(options.script ?? {})
  const simulation = createFakeSimulationForExecution(
    {
      id: 'sim1',
      workspaceId: 'ws1',
      startedById: 'starter',
      ...options.simulation,
    },
    options.cases ?? [{ id: 'case1', maxTurns: 2 }],
    {
      id: 'agent1',
      workspaceId: 'ws1',
      ownerId: 'owner1',
      ...options.agent,
      tools: (options.tools ?? ['sd_list_tickets', 'crm_create_task']).map(
        (toolName) => createFakeSteelAgentTool({ agentId: 'agent1', toolName }),
      ),
    },
  )
  sims.findForExecution.mockResolvedValue(ok(simulation))
  sims.claim.mockResolvedValue(ok(true))
  sims.update.mockResolvedValue(ok({} as never))
  cases.update.mockResolvedValue(ok({} as never))
  cases.failUnfinished.mockResolvedValue(ok(1))
  vi.mocked(AiActionLogRepository.create).mockResolvedValue(ok({} as never))
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
  return { simulation, fake }
}

const caseUpdates = (id = 'case1') =>
  cases.update.mock.calls
    .filter(([caseId]) => caseId === id)
    .map(([, data]) => data as Record<string, unknown>)
const finalSimulationUpdate = () => {
  const calls = sims.update.mock.calls
  return calls[calls.length - 1]?.[1] as Record<string, unknown>
}

beforeEach(() => {
  registry.tools = [readTool, createTool]
  readExecute.mockResolvedValue(
    ok({ data: [{ id: 't1' }], summary: '1 chamado' }),
  )
  createExecute.mockResolvedValue(ok({ data: {}, summary: 'Criada' }))
})

describe('executeSteelAgentSimulation — conversation', () => {
  it('should run a whole conversation, simulate writes and judge it', async () => {
    const { fake } = setup({
      script: {
        agent: [
          { toolCalls: [call('sd_list_tickets')] },
          { toolCalls: [call('crm_create_task')] },
          { text: 'Vou abrir um chamado para você.' },
        ],
        customer: [{ text: customer('Obrigado!', true, 'resolvido') }],
        judge: [{ text: judge(92) }],
      },
      cases: [{ id: 'case1', maxTurns: 3, personaKey: 'irritated_customer' }],
    })

    expect(expectOk(await executeSteelAgentSimulation('sim1'))).toBe(
      'completed',
    )

    // Reads run for real; writes are simulated from the preview.
    expect(readExecute).toHaveBeenCalledWith(
      {
        workspaceId: 'ws1',
        actorId: 'owner1',
        source: 'agent',
        agentId: 'agent1',
      },
      {},
    )
    expect(createExecute).not.toHaveBeenCalled()
    expect(AiActionLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'simulated',
        toolName: 'crm_create_task',
      }),
    )

    const agentRequest = fake.requests.agent[0]
    expect(agentRequest.system).toContain('MODO SIMULAÇÃO DE CONVERSA')
    expect(agentRequest.system).toContain('Acme')
    expect(agentRequest.messages[0]).toEqual({
      role: 'user',
      content: 'Minha internet não volta!',
    })
    expect(agentRequest.tools?.map((t) => t.name)).toEqual([
      'sd_list_tickets',
      'crm_create_task',
    ])
    // The customer sees the agent line as "user" and its own as "assistant".
    expect(fake.requests.customer[0].messages).toEqual([
      expect.objectContaining({ role: 'user' }),
      { role: 'assistant', content: 'Minha internet não volta!' },
      { role: 'user', content: 'Vou abrir um chamado para você.' },
    ])

    const done = caseUpdates().find((u) => u.status === 'DONE')
    expect(done).toMatchObject({
      verdict: 'PASS',
      score: 92,
      endReason: 'resolvido',
      judgeSummary: 'Resumo do avaliador',
    })
    expect(done?.transcript).toEqual([
      { role: 'customer', text: 'Minha internet não volta!' },
      { role: 'agent', text: 'Vou abrir um chamado para você.' },
      { role: 'customer', text: 'Obrigado!' },
    ])
    expect(done?.toolEvents).toEqual([
      expect.objectContaining({
        turn: 1,
        toolName: 'sd_list_tickets',
        status: 'OK',
        title: '1 chamado',
      }),
      expect.objectContaining({
        turn: 1,
        toolName: 'crm_create_task',
        kind: 'CREATE',
        status: 'SIMULATED',
        title: 'Criar tarefa “Ligar”',
      }),
    ])
    expect(JSON.stringify(fake.requests.judge[0].messages)).toContain(
      'Minha internet não volta!',
    )

    expect(finalSimulationUpdate()).toMatchObject({
      status: 'COMPLETED',
      passedCases: 1,
      failedCases: 0,
      avgScore: 92,
      modelKey: 'openai:gpt-4o-mini',
      costUsd: 0.25,
    })
    expect(usage.record).toHaveBeenCalledTimes(1)
    expect(sims.claim).toHaveBeenCalledWith(
      'sim1',
      ['QUEUED'],
      expect.objectContaining({ status: 'RUNNING' }),
    )
  })

  it('should fail a case whose criteria are not all met', async () => {
    setup({
      script: {
        agent: [{ text: 'Não sei.' }],
        customer: [{ text: customer('', true, 'desistiu') }],
        judge: [{ text: judge(95, [true, false]) }],
      },
    })
    await executeSteelAgentSimulation('sim1')
    expect(caseUpdates().find((u) => u.status === 'DONE')).toMatchObject({
      verdict: 'FAIL',
      score: 95,
    })
    expect(finalSimulationUpdate()).toMatchObject({
      status: 'COMPLETED',
      passedCases: 0,
      failedCases: 1,
    })
  })

  it('should stop at the turn limit and keep the customer message', async () => {
    const { fake } = setup({
      script: {
        agent: [{ text: 'R1' }, { text: 'R2' }],
        customer: [{ text: customer('Mais uma dúvida') }],
        judge: [{ text: judge(80) }],
      },
      cases: [{ id: 'case1', maxTurns: 2 }],
    })
    await executeSteelAgentSimulation('sim1')
    const done = caseUpdates().find((u) => u.status === 'DONE')
    expect(done?.endReason).toBe('Limite de mensagens atingido')
    expect(done?.transcript as unknown[]).toHaveLength(4)
    expect(fake.requests.agent).toHaveLength(2)
  })

  it('should end when the customer says nothing, and with a closing message', async () => {
    const { fake } = setup({
      script: {
        agent: [{ text: 'R1' }],
        customer: [{ text: customer('', false) }],
        judge: [{ text: judge(80) }],
      },
    })
    await executeSteelAgentSimulation('sim1')
    expect(caseUpdates().find((u) => u.status === 'DONE')?.endReason).toBe(
      'O cliente não respondeu',
    )

    setup({
      script: {
        agent: [{ text: 'R1' }],
        customer: [{ text: customer('Tchau', true) }],
        judge: [{ text: judge(80) }],
      },
    })
    cases.update.mockClear()
    await executeSteelAgentSimulation('sim1')
    expect(caseUpdates().find((u) => u.status === 'DONE')?.endReason).toBe(
      'O cliente encerrou a conversa',
    )
    expect(fake.requests.judge).toHaveLength(1)
  })

  it('should answer with a placeholder when the agent returns no text', async () => {
    setup({
      script: {
        agent: [{ text: '  ' }],
        customer: [{ text: customer('', true, 'x') }],
        judge: [{ text: judge(80) }],
      },
    })
    await executeSteelAgentSimulation('sim1')
    const done = caseUpdates().find((u) => u.status === 'DONE')
    expect(done?.transcript).toContainEqual({
      role: 'agent',
      text: '(o agente não respondeu)',
    })
  })

  it('should call the model without tools when the agent has none', async () => {
    const { fake } = setup({
      tools: [],
      script: {
        agent: [{ text: 'Oi' }],
        customer: [{ text: customer('', true, 'x') }],
        judge: [{ text: judge(80) }],
      },
    })
    await executeSteelAgentSimulation('sim1')
    expect(fake.requests.agent[0].tools).toBeUndefined()
  })

  it('should fall back to WhatsApp for an unknown channel and default names', async () => {
    const { fake } = setup({
      cases: [
        { id: 'case1', maxTurns: 2, channel: 'SMS', criteria: null as never },
      ],
      script: {
        agent: [{ text: 'Oi' }],
        customer: [{ text: customer('', true, 'x') }],
        judge: [{ text: judge(80, []) }],
      },
    })
    vi.mocked(UserRepository.findById).mockResolvedValue(
      err(databaseError('x')),
    )
    vi.mocked(WorkspaceRepository.findById).mockResolvedValue(
      err(databaseError('x')),
    )
    await executeSteelAgentSimulation('sim1')
    expect(fake.requests.agent[0].system).toContain('WhatsApp')
    expect(fake.requests.agent[0].system).toContain('Workspace')
    expect(fake.requests.agent[0].system).toContain('Responsável')
  })
})

describe('executeSteelAgentSimulation — tools', () => {
  it('should report tool failures to the model and the timeline', async () => {
    readExecute.mockResolvedValue(err(databaseError('db')))
    const { fake } = setup({
      script: {
        agent: [
          {
            toolCalls: [
              call('sd_list_tickets', { bad: true }),
              call('crm_create_task', { bad: true }),
              call('unknown_tool'),
            ],
          },
          { toolCalls: [call('crm_create_task', { fail: true })] },
          { text: 'Não consegui.' },
        ],
        customer: [{ text: customer('', true, 'x') }],
        judge: [{ text: judge(50, [false, false]) }],
      },
    })
    await executeSteelAgentSimulation('sim1')
    const done = caseUpdates().find((u) => u.status === 'DONE')
    const events = done?.toolEvents as {
      status: string
      error: string | null
    }[]
    expect(events.map((e) => e.status)).toEqual([
      'FAILED',
      'FAILED',
      'FAILED',
      'FAILED',
    ])
    expect(events[2].error).toBe('Ferramenta não permitida')
    expect(events[3].error).toBe('Prévia inválida')
    const toolMessages = fake.requests.agent[1].messages.filter(
      (m) => m.role === 'tool',
    )
    expect(toolMessages).toHaveLength(3)
  })

  it('should enforce the per-message tool round limit', async () => {
    const { fake } = setup({
      script: {
        agent: [
          { toolCalls: [call('sd_list_tickets')] },
          { toolCalls: [call('sd_list_tickets')] },
          { toolCalls: [call('sd_list_tickets')] },
          { toolCalls: [call('sd_list_tickets')] },
          { toolCalls: [call('sd_list_tickets')], text: 'Resposta final' },
        ],
        customer: [{ text: customer('', true, 'x') }],
        judge: [{ text: judge(80) }],
      },
    })
    await executeSteelAgentSimulation('sim1')
    expect(fake.requests.agent).toHaveLength(5)
    expect(fake.requests.agent[4].toolChoice).toBe('none')
    const done = caseUpdates().find((u) => u.status === 'DONE')
    const events = done?.toolEvents as {
      status: string
      error: string | null
    }[]
    expect(events[4]).toMatchObject({
      status: 'FAILED',
      error: 'Limite de etapas por mensagem',
    })
    expect(readExecute).toHaveBeenCalledTimes(4)
  })
})

describe('executeSteelAgentSimulation — failures', () => {
  it('should fail a case whose judgement is unusable', async () => {
    setup({
      script: {
        agent: [{ text: 'Oi' }],
        customer: [{ text: customer('', true, 'x') }],
        judge: [{ text: 'sem json' }],
      },
    })
    await executeSteelAgentSimulation('sim1')
    expect(caseUpdates().find((u) => u.status === 'FAILED')).toMatchObject({
      error: 'O avaliador não devolveu um resultado válido',
    })
    expect(finalSimulationUpdate()).toMatchObject({
      status: 'FAILED',
      failedCases: 1,
      error: 'Nenhum cenário foi avaliado.',
    })
  })

  it('should isolate a provider failure and keep running the other cases', async () => {
    setup({
      cases: [
        { id: 'case1', maxTurns: 2 },
        { id: 'case2', maxTurns: 2 },
      ],
      script: {
        agent: [new Error('timeout'), { text: 'Oi' }],
        customer: [{ text: customer('', true, 'x') }],
        judge: [{ text: judge(85) }],
      },
    })
    expect(expectOk(await executeSteelAgentSimulation('sim1'))).toBe(
      'completed',
    )
    expect(caseUpdates('case1').find((u) => u.status === 'FAILED')?.error).toBe(
      'Falha ao falar com o provedor de IA: timeout',
    )
    expect(caseUpdates('case2').find((u) => u.status === 'DONE')).toBeDefined()
    expect(finalSimulationUpdate()).toMatchObject({
      status: 'COMPLETED',
      passedCases: 1,
      failedCases: 1,
      avgScore: 85,
    })
    expect(usage.record).toHaveBeenCalledTimes(2)
  })

  it('should stringify non-Error provider failures', async () => {
    setup({ script: { agent: [new Error('x')] } })
    // Non-Error throw
    const fake = fakeProvider({})
    fake.chat.mockRejectedValueOnce('plain failure')
    usage.prepare.mockResolvedValue(ok(prepared(fake.provider)))
    await executeSteelAgentSimulation('sim1')
    expect(caseUpdates().find((u) => u.status === 'FAILED')?.error).toContain(
      'plain failure',
    )
  })

  it.each([
    [aiQuotaExceeded(10, 5), 'A cota mensal de IA do workspace acabou.'],
    [aiProviderUnavailable(), 'Nenhum modelo de IA disponível no workspace.'],
    [databaseError('db down'), 'db down'],
  ])(
    'should stop the remaining cases when the AI call cannot be prepared',
    async (error, reason) => {
      const { fake } = setup({
        cases: [
          { id: 'case1', maxTurns: 2 },
          { id: 'case2', maxTurns: 2 },
          { id: 'case3', maxTurns: 2 },
        ],
        script: {
          agent: [{ text: 'Oi' }],
          customer: [{ text: customer('', true, 'x') }],
          judge: [{ text: judge(85) }],
        },
      })
      usage.prepare
        .mockResolvedValueOnce(ok(prepared(fake.provider)))
        .mockResolvedValueOnce(err(error))
      await executeSteelAgentSimulation('sim1')
      expect(caseUpdates('case1').some((u) => u.status === 'DONE')).toBe(true)
      expect(caseUpdates('case2')[0]).toMatchObject({
        status: 'FAILED',
        error: expect.stringContaining(reason.slice(0, 20)),
      })
      expect(caseUpdates('case3')[0]).toMatchObject({ status: 'FAILED' })
      expect(finalSimulationUpdate()).toMatchObject({
        status: 'COMPLETED',
        passedCases: 1,
        failedCases: 2,
        error: expect.any(String),
      })
    },
  )
})

describe('executeSteelAgentSimulation — gates', () => {
  it('should do nothing unless the simulation is queued', async () => {
    const { simulation } = setup()
    sims.findForExecution.mockResolvedValue(
      ok({ ...simulation, status: 'RUNNING' }),
    )
    expect(expectOk(await executeSteelAgentSimulation('sim1'))).toBe('noop')
    expect(sims.claim).not.toHaveBeenCalled()
  })

  it('should be a no-op when another worker claimed it first', async () => {
    setup()
    sims.claim.mockResolvedValue(ok(false))
    expect(expectOk(await executeSteelAgentSimulation('sim1'))).toBe('noop')
    expect(cases.update).not.toHaveBeenCalled()
  })

  it('should propagate load and claim failures', async () => {
    setup()
    sims.findForExecution.mockResolvedValue(err(databaseError('x')))
    expectErr(await executeSteelAgentSimulation('sim1'), 'DATABASE_ERROR')
    setup()
    sims.claim.mockResolvedValue(err(databaseError('x')))
    expectErr(await executeSteelAgentSimulation('sim1'), 'DATABASE_ERROR')
  })

  it.each([
    ['no owner', { ownerId: null }, undefined, 'sem responsável'],
    ['owner left', {}, err(forbidden()), 'não é mais membro do workspace'],
    ['suspended', {}, err(workspaceSuspended()), 'workspace está suspenso'],
    ['other access error', {}, err(databaseError('falha x')), 'falha x'],
    [
      'AI off',
      {},
      ok({ ...ACCESS, aiEnabled: false }),
      'Steel AI está desligado',
    ],
    [
      'agents off',
      {},
      ok({ ...ACCESS, agentsEnabled: false }),
      'Steel Agents estão desligados',
    ],
  ])(
    'should skip the simulation (%s)',
    async (_label, agent, accessResult, reason) => {
      setup({ agent })
      if (accessResult) access.mockResolvedValue(accessResult as never)
      expect(expectOk(await executeSteelAgentSimulation('sim1'))).toBe(
        'skipped',
      )
      expect(sims.claim).toHaveBeenCalledWith(
        'sim1',
        ['QUEUED'],
        expect.objectContaining({
          status: 'SKIPPED',
          error: expect.stringContaining(reason),
        }),
      )
      expect(cases.failUnfinished).toHaveBeenCalledWith(
        'sim1',
        expect.stringContaining(reason),
      )
    },
  )

  it('should not touch the cases when the skip claim is lost', async () => {
    setup({ agent: { ownerId: null } })
    sims.claim.mockResolvedValue(ok(false))
    expect(expectOk(await executeSteelAgentSimulation('sim1'))).toBe('skipped')
    expect(cases.failUnfinished).not.toHaveBeenCalled()
    sims.claim.mockResolvedValue(err(databaseError('x')))
    expect(expectOk(await executeSteelAgentSimulation('sim1'))).toBe('skipped')
  })

  it('should allow a paused agent and ignore the agent-mode switch', async () => {
    setup({
      agent: { enabled: false },
      script: {
        agent: [{ text: 'Oi' }],
        customer: [{ text: customer('', true, 'x') }],
        judge: [{ text: judge(90) }],
      },
    })
    access.mockResolvedValue(ok({ ...ACCESS, agentModeEnabled: false }))
    expect(expectOk(await executeSteelAgentSimulation('sim1'))).toBe(
      'completed',
    )
  })
})
