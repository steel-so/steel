import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSimulation,
  createFakeSimulationDetail,
  createFakeSimulationWithCases,
} from '@/src/__tests__/factories/nov-a3-persona-simulation.factory'
import {
  createFakeSteelAgentTool,
  createFakeSteelAgentWithRelations,
} from '@/src/__tests__/factories/steel-agent.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { aiQuotaExceeded, databaseError } from '@/src/errors'
import type { AiChatResponse, AiProvider } from '@/src/lib/ai/types'
import { SYSTEM_PROFILE_PERMISSIONS } from '@/src/lib/permissions'
import { err, ok } from '@/src/lib/result'
import { CreateSteelAgentSimulationSchema } from '@/src/schemas/steel-agent-simulation.schema'

vi.mock('@/src/services/authz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/services/authz')>()),
  assertMember: vi.fn(),
}))
vi.mock('@/src/lib/ai/tools/registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/ai/tools/registry')>()),
  resolveToolAccess: vi.fn(),
  findTool: vi.fn((name: string) =>
    name === 'sd_list_tickets' ? { label: 'Consultar chamados' } : undefined,
  ),
}))
vi.mock('@/src/repositories/steel-agent.repository')
vi.mock('@/src/repositories/steel-agent-simulation.repository')
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/lib/steel-agents/enqueue')

import { resolveToolAccess } from '@/src/lib/ai/tools/registry'
import { enqueueSteelAgentSimulation } from '@/src/lib/steel-agents/enqueue'
import { SteelAgentRepository } from '@/src/repositories/steel-agent.repository'
import { SteelAgentSimulationRepository } from '@/src/repositories/steel-agent-simulation.repository'
import { AiUsageService } from '@/src/services/ai-usage.service'
import { assertMember } from '@/src/services/authz'
import { SteelAgentSimulationService } from '../steel-agent-simulation.service'

const member = vi.mocked(assertMember)
const agents = vi.mocked(SteelAgentRepository)
const sims = vi.mocked(SteelAgentSimulationRepository)
const enqueue = vi.mocked(enqueueSteelAgentSimulation)
const access = vi.mocked(resolveToolAccess)
const usage = vi.mocked(AiUsageService)

const ADMIN = { role: 'ADMIN' as const, isPrivileged: true, permissions: null }
const MEMBER = {
  role: 'MEMBER' as const,
  isPrivileged: false,
  permissions: SYSTEM_PROFILE_PERMISSIONS.MEMBER,
}

const AGENT = createFakeSteelAgentWithRelations({
  id: 'agent1',
  workspaceId: 'ws1',
  ownerId: 'owner1',
  tools: [createFakeSteelAgentTool({ toolName: 'sd_list_tickets' })],
})

const scenario = {
  label: 'Cliente irritado',
  persona: 'Sem paciência',
  scenario: 'Internet fora',
  openingMessage: 'Cadê?',
  criteria: ['Reconhece o problema'],
}
const dto = CreateSteelAgentSimulationSchema.parse({
  scenarios: [scenario, { ...scenario, personaKey: 'cold_lead' }],
})

function actAs(actorId: string, kind: typeof ADMIN | typeof MEMBER) {
  member.mockResolvedValue(
    ok(createFakeMembership({ userId: actorId, ...kind }) as never),
  )
}

beforeEach(() => {
  actAs('owner1', MEMBER)
  agents.findById.mockResolvedValue(ok(AGENT))
  sims.hasActive.mockResolvedValue(ok(false))
  sims.create.mockImplementation(async (data) =>
    ok(
      createFakeSimulationWithCases(
        { id: 'sim1', agentId: data.agentId, workspaceId: data.workspaceId },
        data.cases.map(() => ({})),
      ),
    ),
  )
  sims.update.mockResolvedValue(ok(createFakeSimulation()))
  enqueue.mockResolvedValue(ok(true))
})

describe('SteelAgentSimulationService.create', () => {
  it('should queue a simulation for the agent owner', async () => {
    const result = expectOk(
      await SteelAgentSimulationService.create('owner1', 'ws1', 'agent1', dto),
    )
    expect(result.id).toBe('sim1')
    const [data] = sims.create.mock.calls[0]
    expect(data).toMatchObject({
      workspaceId: 'ws1',
      agentId: 'agent1',
      startedById: 'owner1',
      passScore: 70,
    })
    expect(data.name).toMatch(/^Simulação de \d{4}-\d{2}-\d{2}$/)
    expect(data.cases).toHaveLength(2)
    expect(data.cases[0]).toMatchObject({
      personaKey: null,
      channel: 'WHATSAPP',
      maxTurns: 6,
    })
    expect(data.cases[1].personaKey).toBe('cold_lead')
    expect(enqueue).toHaveBeenCalledWith('sim1')
  })

  it('should keep a custom name', async () => {
    await SteelAgentSimulationService.create('owner1', 'ws1', 'agent1', {
      ...dto,
      name: 'Antes de ativar',
    })
    expect(sims.create.mock.calls[0][0].name).toBe('Antes de ativar')
  })

  it('should let a workspace admin simulate someone else agent', async () => {
    actAs('admin1', ADMIN)
    expectOk(
      await SteelAgentSimulationService.create('admin1', 'ws1', 'agent1', dto),
    )
  })

  it('should forbid a member who is not the owner', async () => {
    actAs('other', MEMBER)
    expectErr(
      await SteelAgentSimulationService.create('other', 'ws1', 'agent1', dto),
      'FORBIDDEN',
    )
    expect(sims.create).not.toHaveBeenCalled()
  })

  it('should propagate a membership failure', async () => {
    member.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentSimulationService.create('u', 'ws1', 'agent1', dto),
      'DATABASE_ERROR',
    )
  })

  it('should return agent not found', async () => {
    agents.findById.mockResolvedValue(
      err({ code: 'STEEL_AGENT_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await SteelAgentSimulationService.create('owner1', 'ws1', 'agent1', dto),
      'STEEL_AGENT_NOT_FOUND',
    )
  })

  it('should refuse while another simulation is active', async () => {
    sims.hasActive.mockResolvedValue(ok(true))
    expectErr(
      await SteelAgentSimulationService.create('owner1', 'ws1', 'agent1', dto),
      'STEEL_AGENT_SIMULATION_IN_PROGRESS',
    )
    expect(sims.create).not.toHaveBeenCalled()
  })

  it('should propagate database errors', async () => {
    sims.hasActive.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentSimulationService.create('owner1', 'ws1', 'agent1', dto),
      'DATABASE_ERROR',
    )
    sims.hasActive.mockResolvedValue(ok(false))
    sims.create.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentSimulationService.create('owner1', 'ws1', 'agent1', dto),
      'DATABASE_ERROR',
    )
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('should fail the simulation when the queue is down', async () => {
    enqueue.mockResolvedValue(
      err({ code: 'INTERNAL_SERVER_ERROR', message: 'fila' }),
    )
    expectErr(
      await SteelAgentSimulationService.create('owner1', 'ws1', 'agent1', dto),
      'INTERNAL_SERVER_ERROR',
    )
    expect(sims.update).toHaveBeenCalledWith(
      'sim1',
      expect.objectContaining({ status: 'FAILED', error: 'fila' }),
    )
  })
})

describe('SteelAgentSimulationService.rerun', () => {
  const previous = createFakeSimulationDetail(
    { id: 'old', agentId: 'agent1', name: 'Base', passScore: 80 },
    [
      { label: 'A', personaKey: null, criteria: ['x'], maxTurns: 4 },
      { label: 'B', criteria: null as never },
    ],
  )

  beforeEach(() => {
    sims.findDetail.mockResolvedValue(ok(previous))
  })

  it('should copy the scenarios into a new simulation', async () => {
    expectOk(
      await SteelAgentSimulationService.rerun('owner1', 'ws1', 'agent1', 'old'),
    )
    const [data] = sims.create.mock.calls[0]
    expect(data.name).toBe('Base (repetição)')
    expect(data.passScore).toBe(80)
    expect(data.cases.map((c) => c.label)).toEqual(['A', 'B'])
    expect(data.cases[0]).toMatchObject({ criteria: ['x'], maxTurns: 4 })
    expect(data.cases[1].criteria).toEqual([])
  })

  it('should not find a simulation of another agent', async () => {
    sims.findDetail.mockResolvedValue(
      ok({ ...previous, agentId: 'other-agent' }),
    )
    expectErr(
      await SteelAgentSimulationService.rerun('owner1', 'ws1', 'agent1', 'old'),
      'STEEL_AGENT_SIMULATION_NOT_FOUND',
    )
  })

  it('should propagate load and gate errors', async () => {
    sims.findDetail.mockResolvedValue(
      err({ code: 'STEEL_AGENT_SIMULATION_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await SteelAgentSimulationService.rerun('owner1', 'ws1', 'agent1', 'old'),
      'STEEL_AGENT_SIMULATION_NOT_FOUND',
    )
    actAs('other', MEMBER)
    expectErr(
      await SteelAgentSimulationService.rerun('other', 'ws1', 'agent1', 'old'),
      'FORBIDDEN',
    )
  })

  it('should refuse while another simulation is active', async () => {
    sims.hasActive.mockResolvedValue(ok(true))
    expectErr(
      await SteelAgentSimulationService.rerun('owner1', 'ws1', 'agent1', 'old'),
      'STEEL_AGENT_SIMULATION_IN_PROGRESS',
    )
  })
})

describe('SteelAgentSimulationService.generateScenarios', () => {
  const draftJson = JSON.stringify({
    scenarios: [
      {
        label: 'Irritado',
        persona: 'P',
        scenario: 'S',
        channel: 'CHAT',
        openingMessage: 'Oi',
        criteria: ['a'],
      },
    ],
  })

  function provider(chat: () => Promise<Partial<AiChatResponse>>) {
    const fake = {
      id: 'openai',
      chat: vi.fn(chat),
      chatStream: vi.fn(),
    } as unknown as AiProvider
    usage.prepare.mockResolvedValue(
      ok({
        feature: 'STEEL_AGENT',
        provider: fake,
        model: { key: 'k', provider: 'openai', model: 'm', label: 'M' },
        usdPer1kTokens: 1,
      } as never),
    )
    return fake
  }

  beforeEach(() => {
    access.mockResolvedValue(ok({ aiEnabled: true } as never))
    usage.record.mockResolvedValue(undefined)
  })

  it('should return the parsed drafts and record the usage', async () => {
    const fake = provider(async () => ({
      text: draftJson,
      usage: { inputTokens: 10, outputTokens: 5 },
    }))
    const drafts = expectOk(
      await SteelAgentSimulationService.generateScenarios(
        'owner1',
        'ws1',
        'agent1',
        { count: 3, focus: 'cobrança' },
      ),
    )
    expect(drafts).toHaveLength(1)
    expect(drafts[0].channel).toBe('CHAT')
    const request = vi.mocked(fake.chat).mock.calls[0][0]
    expect(JSON.stringify(request.messages)).toContain('Consultar chamados')
    expect(JSON.stringify(request.messages)).toContain('cobrança')
    expect(usage.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: 'ws1',
        userId: 'owner1',
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    )
  })

  it('should fail when the model returns no usable scenario', async () => {
    provider(async () => ({
      text: 'nada',
      usage: { inputTokens: 1, outputTokens: 1 },
    }))
    expectErr(
      await SteelAgentSimulationService.generateScenarios(
        'owner1',
        'ws1',
        'agent1',
        { count: 3 },
      ),
      'STEEL_AGENT_SIMULATION_GENERATION_FAILED',
    )
    expect(usage.record).toHaveBeenCalled()
  })

  it('should map provider exceptions to a generation failure', async () => {
    provider(async () => {
      throw new Error('timeout')
    })
    expectErr(
      await SteelAgentSimulationService.generateScenarios(
        'owner1',
        'ws1',
        'agent1',
        { count: 3 },
      ),
      'STEEL_AGENT_SIMULATION_GENERATION_FAILED',
    )
    provider(async () => {
      throw 'plain'
    })
    expectErr(
      await SteelAgentSimulationService.generateScenarios(
        'owner1',
        'ws1',
        'agent1',
        { count: 3 },
      ),
      'STEEL_AGENT_SIMULATION_GENERATION_FAILED',
    )
  })

  it('should stop on gate, access, AI-off and quota errors', async () => {
    actAs('other', MEMBER)
    expectErr(
      await SteelAgentSimulationService.generateScenarios(
        'other',
        'ws1',
        'agent1',
        { count: 3 },
      ),
      'FORBIDDEN',
    )
    actAs('owner1', MEMBER)
    access.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentSimulationService.generateScenarios(
        'owner1',
        'ws1',
        'agent1',
        { count: 3 },
      ),
      'DATABASE_ERROR',
    )
    access.mockResolvedValue(ok({ aiEnabled: false } as never))
    expectErr(
      await SteelAgentSimulationService.generateScenarios(
        'owner1',
        'ws1',
        'agent1',
        { count: 3 },
      ),
      'AI_DISABLED',
    )
    access.mockResolvedValue(ok({ aiEnabled: true } as never))
    usage.prepare.mockResolvedValue(err(aiQuotaExceeded(10, 5)))
    expectErr(
      await SteelAgentSimulationService.generateScenarios(
        'owner1',
        'ws1',
        'agent1',
        { count: 3 },
      ),
      'AI_QUOTA_EXCEEDED',
    )
  })

  it('should label unknown tools by name', async () => {
    agents.findById.mockResolvedValue(
      ok({
        ...AGENT,
        tools: [createFakeSteelAgentTool({ toolName: 'gone_tool' })],
      }),
    )
    const fake = provider(async () => ({
      text: draftJson,
      usage: { inputTokens: 1, outputTokens: 1 },
    }))
    await SteelAgentSimulationService.generateScenarios(
      'owner1',
      'ws1',
      'agent1',
      { count: 1 },
    )
    expect(JSON.stringify(vi.mocked(fake.chat).mock.calls[0][0])).toContain(
      'gone_tool',
    )
  })
})

describe('SteelAgentSimulationService reads', () => {
  it('should list simulations of the agent', async () => {
    sims.listByAgent.mockResolvedValue(
      ok([
        createFakeSimulation({ id: 's1' }),
        createFakeSimulation({ id: 's2' }),
      ]),
    )
    const list = expectOk(
      await SteelAgentSimulationService.list('u', 'ws1', 'agent1', {
        limit: 20,
      }),
    )
    expect(list.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(sims.listByAgent).toHaveBeenCalledWith('agent1', 20)
  })

  it('should propagate list errors', async () => {
    member.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentSimulationService.list('u', 'ws1', 'agent1', {
        limit: 20,
      }),
      'DATABASE_ERROR',
    )
    actAs('u', MEMBER)
    agents.findById.mockResolvedValue(
      err({ code: 'STEEL_AGENT_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await SteelAgentSimulationService.list('u', 'ws1', 'agent1', {
        limit: 20,
      }),
      'STEEL_AGENT_NOT_FOUND',
    )
    agents.findById.mockResolvedValue(ok(AGENT))
    sims.listByAgent.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentSimulationService.list('u', 'ws1', 'agent1', {
        limit: 20,
      }),
      'DATABASE_ERROR',
    )
  })

  it('should return the detail of a simulation of the agent', async () => {
    sims.findDetail.mockResolvedValue(
      ok(createFakeSimulationDetail({ id: 's1', agentId: 'agent1' })),
    )
    const detail = expectOk(
      await SteelAgentSimulationService.get('u', 'ws1', 'agent1', 's1'),
    )
    expect(detail.cases).toHaveLength(1)
  })

  it('should hide a simulation of another agent and propagate errors', async () => {
    sims.findDetail.mockResolvedValue(
      ok(createFakeSimulationDetail({ id: 's1', agentId: 'other' })),
    )
    expectErr(
      await SteelAgentSimulationService.get('u', 'ws1', 'agent1', 's1'),
      'STEEL_AGENT_SIMULATION_NOT_FOUND',
    )
    sims.findDetail.mockResolvedValue(
      err({ code: 'STEEL_AGENT_SIMULATION_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await SteelAgentSimulationService.get('u', 'ws1', 'agent1', 's1'),
      'STEEL_AGENT_SIMULATION_NOT_FOUND',
    )
    member.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentSimulationService.get('u', 'ws1', 'agent1', 's1'),
      'DATABASE_ERROR',
    )
  })
})

describe('SteelAgentSimulationService.delete', () => {
  beforeEach(() => {
    actAs('admin1', ADMIN)
    sims.findDetail.mockResolvedValue(
      ok(createFakeSimulationDetail({ id: 's1', agentId: 'agent1' })),
    )
    sims.delete.mockResolvedValue(ok(true))
  })

  it('should delete and return the removed simulation', async () => {
    const removed = expectOk(
      await SteelAgentSimulationService.delete('admin1', 'ws1', 'agent1', 's1'),
    )
    expect(removed.id).toBe('s1')
    expect(sims.delete).toHaveBeenCalledWith('s1')
    expect(member).toHaveBeenCalledWith(
      'admin1',
      'ws1',
      expect.objectContaining({ action: 'DELETE' }),
    )
  })

  it('should stop on permission, lookup, ownership and database errors', async () => {
    member.mockResolvedValue(err({ code: 'FORBIDDEN', message: 'x' }))
    expectErr(
      await SteelAgentSimulationService.delete('u', 'ws1', 'agent1', 's1'),
      'FORBIDDEN',
    )
    actAs('admin1', ADMIN)
    sims.findDetail.mockResolvedValue(
      ok(createFakeSimulationDetail({ id: 's1', agentId: 'other' })),
    )
    expectErr(
      await SteelAgentSimulationService.delete('admin1', 'ws1', 'agent1', 's1'),
      'STEEL_AGENT_SIMULATION_NOT_FOUND',
    )
    sims.findDetail.mockResolvedValue(
      err({ code: 'STEEL_AGENT_SIMULATION_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await SteelAgentSimulationService.delete('admin1', 'ws1', 'agent1', 's1'),
      'STEEL_AGENT_SIMULATION_NOT_FOUND',
    )
    sims.findDetail.mockResolvedValue(
      ok(createFakeSimulationDetail({ id: 's1', agentId: 'agent1' })),
    )
    sims.delete.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentSimulationService.delete('admin1', 'ws1', 'agent1', 's1'),
      'DATABASE_ERROR',
    )
  })
})
