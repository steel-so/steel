import type { SteelAgentVersion } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeAiEvalRunWithUser,
  createFakeAiEvalSetWithCases,
} from '@/src/__tests__/factories/ai-quality.factory'
import { createFakeWorkspaceAiSettings } from '@/src/__tests__/factories/ai-settings.factory'
import { createFakeSteelAgentVersion } from '@/src/__tests__/factories/nov-a2-agent-versions.factory'
import {
  createFakeSteelAgentTool,
  createFakeSteelAgentWithRelations,
} from '@/src/__tests__/factories/steel-agent.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { SYSTEM_PROFILE_PERMISSIONS } from '@/src/lib/permissions'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/authz', () => ({ assertMember: vi.fn() }))
vi.mock('@/src/repositories/steel-agent-version.repository')
vi.mock('@/src/repositories/steel-agent.repository')
vi.mock('@/src/repositories/ai-eval.repository')
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/repositories/steel-agent-simulation.repository')
vi.mock('@/src/lib/steel-agents/enqueue', () => ({
  enqueueSteelAgentSimulation: vi.fn(),
}))
vi.mock('@/src/services/steel-agent-notifications', () => ({
  notifyAgentVersionGateFinished: vi.fn(async () => 1),
}))
vi.mock('@/src/lib/queue/queues', () => ({ getAiEvalQueue: vi.fn() }))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { getAiEvalQueue } from '@/src/lib/queue/queues'
import { enqueueSteelAgentSimulation } from '@/src/lib/steel-agents/enqueue'
import { AiEvalRepository } from '@/src/repositories/ai-eval.repository'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import {
  SteelAgentRepository,
  type SteelAgentWithRelations,
} from '@/src/repositories/steel-agent.repository'
import { SteelAgentSimulationRepository } from '@/src/repositories/steel-agent-simulation.repository'
import { SteelAgentVersionRepository } from '@/src/repositories/steel-agent-version.repository'
import { assertMember } from '@/src/services/authz'
import { notifyAgentVersionGateFinished } from '@/src/services/steel-agent-notifications'
import {
  SteelAgentVersionService,
  type SubmitVersionInput,
} from '../steel-agent-version.service'

const member = vi.mocked(assertMember)
const versions = vi.mocked(SteelAgentVersionRepository)
const agents = vi.mocked(SteelAgentRepository)
const evals = vi.mocked(AiEvalRepository)
const settings = vi.mocked(WorkspaceAiSettingsRepository)
const sims = vi.mocked(SteelAgentSimulationRepository)
const enqueueSim = vi.mocked(enqueueSteelAgentSimulation)
const notifyGate = vi.mocked(notifyAgentVersionGateFinished)
const queue = { add: vi.fn() }

const SCENARIOS = {
  passScore: 75,
  cases: [
    {
      label: 'Cliente irritado',
      personaKey: null,
      persona: 'Cliente',
      scenario: 'Internet fora',
      channel: 'WHATSAPP',
      openingMessage: 'Oi',
      criteria: ['Pede desculpas'],
      maxTurns: 4,
    },
  ],
}

const WS = 'ws1'
const AGENT_ID = 'agent1'
const ADMIN = { role: 'ADMIN' as const, isPrivileged: true, permissions: null }
const VIEWER = {
  role: 'VIEWER' as const,
  isPrivileged: false,
  permissions: SYSTEM_PROFILE_PERMISSIONS.VIEWER,
}

const agent = (over: Partial<SteelAgentWithRelations> = {}) =>
  createFakeSteelAgentWithRelations({
    id: AGENT_ID,
    workspaceId: WS,
    publishedVersionId: 'v1',
    evalSetId: 'set1',
    evalMinPassRate: 0.8,
    tools: [
      createFakeSteelAgentTool({ toolName: 'sd_list_tickets', mode: 'AUTO' }),
    ],
    ...over,
  })

const version = (over: Partial<SteelAgentVersion> = {}) =>
  createFakeSteelAgentVersion({
    id: 'v2',
    workspaceId: WS,
    agentId: AGENT_ID,
    number: 2,
    status: 'PENDING_EVAL',
    ...over,
  })

const CONTENT = {
  instructions: 'Novo texto',
  maxToolRounds: 6,
  tools: [{ toolName: 'sd_list_tickets', mode: 'AUTO' as const }],
}

beforeEach(() => {
  vi.resetAllMocks()
  member.mockResolvedValue(ok(ADMIN))
  agents.findById.mockResolvedValue(ok(agent()))
  versions.findPending.mockResolvedValue(ok(null))
  versions.create.mockImplementation(async (data) =>
    ok(
      version({
        ...data,
        id: 'v2',
        tools: data.tools as never,
        status: data.status,
      }),
    ),
  )
  versions.update.mockImplementation(async (id, data) =>
    ok(version({ id, ...data })),
  )
  versions.publish.mockImplementation(async (v) =>
    ok({ ...v, status: 'PUBLISHED' as const }),
  )
  versions.makeChallenger.mockImplementation(async (id, _agentId, pct) =>
    ok(version({ id, status: 'CHALLENGER', rolloutPercent: pct })),
  )
  versions.close.mockImplementation(async (id, _a, status, extra) =>
    ok(version({ id, status, ...extra })),
  )
  versions.setPublishedPointer.mockResolvedValue(ok(true))
  evals.findSet.mockResolvedValue(
    ok(
      createFakeAiEvalSetWithCases({
        id: 'set1',
        target: 'STEEL_AGENT',
        caseCount: 4,
      }),
    ),
  )
  evals.findActiveRun.mockResolvedValue(ok(null))
  evals.createRun.mockResolvedValue(
    ok(createFakeAiEvalRunWithUser({ id: 'run1' })),
  )
  evals.finishRun.mockResolvedValue(ok({} as never))
  settings.findByWorkspace.mockResolvedValue(
    ok(createFakeWorkspaceAiSettings({ aiEnabled: true })),
  )
  vi.mocked(getAiEvalQueue).mockReturnValue(queue as never)
  queue.add.mockResolvedValue({})
  sims.latestScenarioSet.mockResolvedValue(ok(SCENARIOS))
  sims.create.mockResolvedValue(ok({ id: 'sim1' } as never))
  sims.update.mockResolvedValue(ok({} as never))
  enqueueSim.mockResolvedValue(ok(true))
})

describe('SteelAgentVersionService.checkEvalSet', () => {
  it('should accept a STEEL_AGENT set with cases', async () => {
    const result = expectOk(
      await SteelAgentVersionService.checkEvalSet(WS, 'set1', {
        requireCases: true,
      }),
    )
    expect(result.caseCount).toBe(4)
  })

  it('should reject a missing set, a wrong target and an empty set', async () => {
    evals.findSet.mockResolvedValue(ok(null))
    expectErr(
      await SteelAgentVersionService.checkEvalSet(WS, 'set1', {
        requireCases: false,
      }),
      'STEEL_AGENT_EVAL_SET_INVALID',
    )
    evals.findSet.mockResolvedValue(
      ok(createFakeAiEvalSetWithCases({ target: 'WHATSAPP_REPLY' })),
    )
    expectErr(
      await SteelAgentVersionService.checkEvalSet(WS, 'set1', {
        requireCases: false,
      }),
      'STEEL_AGENT_EVAL_SET_INVALID',
    )
    evals.findSet.mockResolvedValue(
      ok(createFakeAiEvalSetWithCases({ target: 'STEEL_AGENT', caseCount: 0 })),
    )
    expectErr(
      await SteelAgentVersionService.checkEvalSet(WS, 'set1', {
        requireCases: true,
      }),
      'STEEL_AGENT_EVAL_SET_INVALID',
    )
    expectOk(
      await SteelAgentVersionService.checkEvalSet(WS, 'set1', {
        requireCases: false,
      }),
    )
    evals.findSet.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentVersionService.checkEvalSet(WS, 'set1', {
        requireCases: false,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('SteelAgentVersionService.ensureBaseline', () => {
  it('should do nothing when the agent already has a published version', async () => {
    expectOk(await SteelAgentVersionService.ensureBaseline(agent(), 'u1'))
    expect(versions.create).not.toHaveBeenCalled()
  })

  it('should record the current state as v1', async () => {
    expectOk(
      await SteelAgentVersionService.ensureBaseline(
        agent({ publishedVersionId: null }),
        'u1',
      ),
    )
    expect(versions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PUBLISHED',
        changeNote: 'Versão inicial',
        tools: [{ toolName: 'sd_list_tickets', mode: 'AUTO' }],
      }),
    )
    expect(versions.setPublishedPointer).toHaveBeenCalledWith(AGENT_ID, 'v2')
  })

  it('should propagate repository errors', async () => {
    versions.create.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentVersionService.ensureBaseline(
        agent({ publishedVersionId: null }),
        null,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('SteelAgentVersionService.submit', () => {
  const submit = (over: Partial<SubmitVersionInput> = {}) =>
    SteelAgentVersionService.submit({
      actorId: 'u1',
      agent: agent(),
      content: CONTENT,
      changeNote: 'Nota',
      rolloutPercent: null,
      evalSetId: 'set1',
      ...over,
    })

  it('should create a pending version and queue the gate eval', async () => {
    const created = expectOk(await submit())
    expect(created.status).toBe('PENDING_EVAL')
    expect(evals.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        setId: 'set1',
        agentVersionId: 'v2',
        reason: 'prompt_change',
        caseCount: 4,
      }),
    )
    expect(queue.add).toHaveBeenCalledWith(
      'run',
      { runId: 'run1' },
      { jobId: 'ai-eval-run1' },
    )
    expect(versions.update).toHaveBeenCalledWith('v2', { evalRunId: 'run1' })
    expect(versions.publish).not.toHaveBeenCalled()
  })

  it('should publish at once without a gate set', async () => {
    const created = expectOk(await submit({ evalSetId: null }))
    expect(created.status).toBe('PUBLISHED')
    expect(evals.createRun).not.toHaveBeenCalled()
    expect(versions.publish).toHaveBeenCalled()
  })

  it('should start an A/B challenger at once when a rollout is asked', async () => {
    const created = expectOk(
      await submit({ evalSetId: null, rolloutPercent: 30 }),
    )
    expect(created.status).toBe('CHALLENGER')
    expect(versions.makeChallenger).toHaveBeenCalledWith('v2', AGENT_ID, 30)
  })

  it('should record v1 first for a legacy agent', async () => {
    expectOk(await submit({ agent: agent({ publishedVersionId: null }) }))
    expect(versions.create).toHaveBeenCalledTimes(2)
    expect(versions.create.mock.calls[0][0].status).toBe('PUBLISHED')
  })

  it('should refuse a second pending version', async () => {
    versions.findPending.mockResolvedValue(ok(version()))
    expectErr(await submit(), 'STEEL_AGENT_VERSION_PENDING')
    expect(versions.create).not.toHaveBeenCalled()
  })

  it('should refuse an invalid gate set before creating anything', async () => {
    evals.findSet.mockResolvedValue(ok(null))
    expectErr(await submit(), 'STEEL_AGENT_EVAL_SET_INVALID')
    expect(versions.create).not.toHaveBeenCalled()
  })

  it('should discard the version when the eval cannot start', async () => {
    settings.findByWorkspace.mockResolvedValue(
      ok(createFakeWorkspaceAiSettings({ aiEnabled: false })),
    )
    expectErr(await submit(), 'AI_DISABLED')
    expect(versions.close).toHaveBeenCalledWith('v2', AGENT_ID, 'DISCARDED', {
      evalNote: expect.any(String),
    })

    settings.findByWorkspace.mockResolvedValue(
      ok(createFakeWorkspaceAiSettings({ aiEnabled: true })),
    )
    evals.findActiveRun.mockResolvedValue(ok({ id: 'busy' } as never))
    expectErr(await submit(), 'STEEL_AGENT_EVAL_SET_INVALID')

    evals.findActiveRun.mockResolvedValue(ok(null))
    evals.createRun.mockResolvedValue(err(databaseError('x')))
    expectErr(await submit(), 'DATABASE_ERROR')

    settings.findByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(await submit(), 'DATABASE_ERROR')
    evals.findActiveRun.mockResolvedValue(err(databaseError('x')))
    settings.findByWorkspace.mockResolvedValue(
      ok(createFakeWorkspaceAiSettings({ aiEnabled: true })),
    )
    expectErr(await submit(), 'DATABASE_ERROR')
  })

  it('should fail the eval run and discard the version when the queue is down', async () => {
    queue.add.mockRejectedValueOnce(new Error('redis down'))
    expectErr(await submit(), 'INTERNAL_SERVER_ERROR')
    expect(evals.finishRun).toHaveBeenCalledWith(
      'run1',
      expect.objectContaining({ status: 'FAILED' }),
    )
    expect(versions.close).toHaveBeenCalled()

    queue.add.mockRejectedValueOnce('weird')
    expectErr(await submit(), 'INTERNAL_SERVER_ERROR')
  })

  it('should propagate repository errors', async () => {
    versions.findPending.mockResolvedValue(err(databaseError('x')))
    expectErr(await submit(), 'DATABASE_ERROR')
    versions.findPending.mockResolvedValue(ok(null))

    versions.create.mockResolvedValue(err(databaseError('x')))
    expectErr(await submit(), 'DATABASE_ERROR')
    versions.create.mockImplementation(async (data) =>
      ok(version({ ...data, tools: data.tools as never, id: 'v2' })),
    )

    versions.publish.mockResolvedValue(err(databaseError('x')))
    expectErr(await submit({ evalSetId: null }), 'DATABASE_ERROR')
  })
})

describe('SteelAgentVersionService.checkSimulationGate', () => {
  it('should accept an agent with saved scenarios', async () => {
    expect(
      expectOk(await SteelAgentVersionService.checkSimulationGate('a')),
    ).toBe(true)
  })

  it('should refuse an agent without scenarios and propagate errors', async () => {
    sims.latestScenarioSet.mockResolvedValue(ok(null))
    expectErr(
      await SteelAgentVersionService.checkSimulationGate('a'),
      'STEEL_AGENT_SIM_GATE_INVALID',
    )
    sims.latestScenarioSet.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentVersionService.checkSimulationGate('a'),
      'DATABASE_ERROR',
    )
  })
})

describe('SteelAgentVersionService.submit with the simulation gate', () => {
  const submit = (over: Partial<SubmitVersionInput> = {}) =>
    SteelAgentVersionService.submit({
      actorId: 'u1',
      agent: agent({ simGateEnabled: true }),
      content: CONTENT,
      changeNote: null,
      rolloutPercent: null,
      evalSetId: null,
      ...over,
    })

  it('should replay the saved scenarios when there is no eval set', async () => {
    const created = expectOk(await submit())
    expect(created.status).toBe('PENDING_EVAL')
    expect(sims.create).toHaveBeenCalledWith({
      workspaceId: WS,
      agentId: AGENT_ID,
      name: 'Trava da versão 2',
      startedById: 'u1',
      passScore: 75,
      cases: SCENARIOS.cases,
      agentVersionId: 'v2',
    })
    expect(enqueueSim).toHaveBeenCalledWith('sim1')
    expect(versions.update).toHaveBeenCalledWith('v2', { simulationId: 'sim1' })
    expect(versions.publish).not.toHaveBeenCalled()
    expect(evals.createRun).not.toHaveBeenCalled()
  })

  it('should run the eval first when both gates are on', async () => {
    expectOk(await submit({ evalSetId: 'set1' }))
    expect(evals.createRun).toHaveBeenCalled()
    expect(sims.create).not.toHaveBeenCalled()
  })

  it('should honor the effective setting of the edit over the stored one', async () => {
    expectOk(
      await submit({
        agent: agent({ simGateEnabled: false }),
        simGateEnabled: true,
      }),
    )
    expect(sims.create).toHaveBeenCalled()
    sims.create.mockClear()
    expectOk(
      await submit({
        agent: agent({ simGateEnabled: true }),
        simGateEnabled: false,
      }),
    )
    expect(sims.create).not.toHaveBeenCalled()
    expect(versions.publish).toHaveBeenCalled()
  })

  it('should refuse before creating anything when there are no scenarios', async () => {
    sims.latestScenarioSet.mockResolvedValue(ok(null))
    expectErr(await submit(), 'STEEL_AGENT_SIM_GATE_INVALID')
    expect(versions.create).not.toHaveBeenCalled()
    sims.latestScenarioSet.mockResolvedValue(err(databaseError('x')))
    expectErr(await submit(), 'DATABASE_ERROR')
  })

  it('should discard the version when the simulation cannot start', async () => {
    settings.findByWorkspace.mockResolvedValue(
      ok(createFakeWorkspaceAiSettings({ aiEnabled: false })),
    )
    expectErr(await submit(), 'AI_DISABLED')
    expect(versions.close).toHaveBeenCalledWith('v2', AGENT_ID, 'DISCARDED', {
      evalNote: expect.any(String),
    })

    settings.findByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(await submit(), 'DATABASE_ERROR')
  })

  it('should fail the simulation and discard the version when the queue is down', async () => {
    enqueueSim.mockResolvedValue(
      err(appError('INTERNAL_SERVER_ERROR', 'fila fora')),
    )
    expectErr(await submit(), 'INTERNAL_SERVER_ERROR')
    expect(sims.update).toHaveBeenCalledWith(
      'sim1',
      expect.objectContaining({ status: 'FAILED', error: 'fila fora' }),
    )
    expect(versions.close).toHaveBeenCalledWith(
      'v2',
      AGENT_ID,
      'DISCARDED',
      expect.anything(),
    )
  })

  it('should propagate a failure to create the simulation', async () => {
    sims.create.mockResolvedValue(err(databaseError('x')))
    expectErr(await submit(), 'DATABASE_ERROR')
  })
})

describe('SteelAgentVersionService.list', () => {
  it('should return versions with their metrics', async () => {
    versions.listByAgent.mockResolvedValue(
      ok([version({ id: 'v1', number: 1, status: 'PUBLISHED' })]),
    )
    versions.statsRows.mockResolvedValue(
      ok({
        runs: [{ versionId: 'v1', status: 'SUCCEEDED', costUsd: 1, rounds: 2 }],
        approvals: [],
      }),
    )
    const list = expectOk(
      await SteelAgentVersionService.list('u1', WS, AGENT_ID),
    )
    expect(list.versions[0].stats.runs).toBe(1)
    expect(list).toMatchObject({
      publishedVersionId: 'v1',
      evalSetId: 'set1',
      evalMinPassRate: 0.8,
      canManage: true,
    })
  })

  it('should let a viewer read but not manage, and propagate errors', async () => {
    member.mockResolvedValue(ok(VIEWER))
    versions.listByAgent.mockResolvedValue(ok([]))
    versions.statsRows.mockResolvedValue(ok({ runs: [], approvals: [] }))
    expect(
      expectOk(await SteelAgentVersionService.list('u1', WS, AGENT_ID))
        .canManage,
    ).toBe(false)

    versions.statsRows.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentVersionService.list('u1', WS, AGENT_ID),
      'DATABASE_ERROR',
    )
    versions.listByAgent.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentVersionService.list('u1', WS, AGENT_ID),
      'DATABASE_ERROR',
    )
    agents.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentVersionService.list('u1', WS, AGENT_ID),
      'DATABASE_ERROR',
    )
    member.mockResolvedValue(err(forbidden()))
    expectErr(
      await SteelAgentVersionService.list('u1', WS, AGENT_ID),
      'FORBIDDEN',
    )
  })
})

describe('SteelAgentVersionService.promote / discard', () => {
  beforeEach(() => {
    versions.findById.mockResolvedValue(ok(version({ status: 'CHALLENGER' })))
  })

  it('should promote the challenger', async () => {
    const ref = expectOk(
      await SteelAgentVersionService.promote('u1', WS, AGENT_ID, 'v2'),
    )
    expect(ref).toEqual({ id: 'v2', number: 2, status: 'PUBLISHED' })
    expect(member).toHaveBeenCalledWith('u1', WS, {
      resource: 'steel-agents',
      action: 'EDIT',
    })
  })

  it('should only promote a challenger', async () => {
    versions.findById.mockResolvedValue(ok(version({ status: 'REJECTED' })))
    expectErr(
      await SteelAgentVersionService.promote('u1', WS, AGENT_ID, 'v2'),
      'STEEL_AGENT_VERSION_INVALID_STATE',
    )
  })

  it('should propagate a publish error', async () => {
    versions.publish.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentVersionService.promote('u1', WS, AGENT_ID, 'v2'),
      'DATABASE_ERROR',
    )
  })

  it('should discard a pending or challenger version only', async () => {
    const ref = expectOk(
      await SteelAgentVersionService.discard('u1', WS, AGENT_ID, 'v2'),
    )
    expect(ref.status).toBe('DISCARDED')
    versions.findById.mockResolvedValue(ok(version({ status: 'PUBLISHED' })))
    expectErr(
      await SteelAgentVersionService.discard('u1', WS, AGENT_ID, 'v2'),
      'STEEL_AGENT_VERSION_INVALID_STATE',
    )
    versions.findById.mockResolvedValue(ok(version({ status: 'PENDING_EVAL' })))
    versions.close.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentVersionService.discard('u1', WS, AGENT_ID, 'v2'),
      'DATABASE_ERROR',
    )
  })

  it('should forbid non-editors and hide versions of other agents', async () => {
    member.mockResolvedValue(err(forbidden()))
    expectErr(
      await SteelAgentVersionService.promote('u1', WS, AGENT_ID, 'v2'),
      'FORBIDDEN',
    )
    member.mockResolvedValue(ok(ADMIN))
    versions.findById.mockResolvedValue(
      ok(version({ agentId: 'other', status: 'CHALLENGER' })),
    )
    expectErr(
      await SteelAgentVersionService.promote('u1', WS, AGENT_ID, 'v2'),
      'STEEL_AGENT_VERSION_NOT_FOUND',
    )
    versions.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentVersionService.promote('u1', WS, AGENT_ID, 'v2'),
      'DATABASE_ERROR',
    )
    agents.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentVersionService.promote('u1', WS, AGENT_ID, 'v2'),
      'DATABASE_ERROR',
    )
  })
})

describe('SteelAgentVersionService.restore', () => {
  it('should submit the old content as a new gated version', async () => {
    versions.findById.mockResolvedValue(
      ok(version({ id: 'v0', number: 1, status: 'SUPERSEDED' })),
    )
    const ref = expectOk(
      await SteelAgentVersionService.restore('u1', WS, AGENT_ID, 'v0', {
        rolloutPercent: 10,
      }),
    )
    expect(ref.status).toBe('PENDING_EVAL')
    expect(versions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        changeNote: 'Restaurada da v1',
        rolloutPercent: 10,
      }),
    )
  })

  it('should refuse versions already in use or pending, and propagate errors', async () => {
    for (const status of ['PUBLISHED', 'CHALLENGER', 'PENDING_EVAL'] as const) {
      versions.findById.mockResolvedValue(ok(version({ status })))
      expectErr(
        await SteelAgentVersionService.restore('u1', WS, AGENT_ID, 'v2', {
          changeNote: 'x',
        }),
        'STEEL_AGENT_VERSION_INVALID_STATE',
      )
    }
    versions.findById.mockResolvedValue(ok(version({ status: 'REJECTED' })))
    versions.findPending.mockResolvedValue(ok(version()))
    expectErr(
      await SteelAgentVersionService.restore('u1', WS, AGENT_ID, 'v2', {}),
      'STEEL_AGENT_VERSION_PENDING',
    )
  })
})

describe('SteelAgentVersionService.onEvalFinished', () => {
  const finished = (
    over: Partial<
      Parameters<typeof SteelAgentVersionService.onEvalFinished>[0]
    > = {},
  ) => ({
    versionId: 'v2',
    evalRunId: 'run1',
    status: 'DONE' as const,
    passed: 9,
    failed: 1,
    error: null,
    ...over,
  })

  beforeEach(() => {
    versions.findByIdUnscoped.mockResolvedValue(ok(version()))
  })

  it('should publish when the pass rate reaches the minimum', async () => {
    await SteelAgentVersionService.onEvalFinished(finished())
    expect(versions.update).toHaveBeenCalledWith('v2', {
      evalRunId: 'run1',
      evalPassed: 9,
      evalTotal: 10,
    })
    expect(versions.publish).toHaveBeenCalled()
    expect(versions.close).not.toHaveBeenCalled()
  })

  it('should start the A/B when the version asked for a rollout', async () => {
    versions.update.mockResolvedValue(
      ok(version({ rolloutPercent: 20, evalRunId: 'run1' })),
    )
    await SteelAgentVersionService.onEvalFinished(finished())
    expect(versions.makeChallenger).toHaveBeenCalledWith('v2', AGENT_ID, 20)
  })

  it('should reject a version under the minimum with a pt-BR note', async () => {
    await SteelAgentVersionService.onEvalFinished(
      finished({ passed: 5, failed: 5 }),
    )
    expect(versions.close).toHaveBeenCalledWith('v2', AGENT_ID, 'REJECTED', {
      evalNote: 'Passou em 5 de 10 casos (50%); o mínimo é 80%.',
    })
    expect(versions.publish).not.toHaveBeenCalled()
  })

  it('should reject a failed run and an empty one', async () => {
    await SteelAgentVersionService.onEvalFinished(
      finished({
        status: 'FAILED',
        error: 'Cota acabou',
        passed: 0,
        failed: 0,
      }),
    )
    expect(versions.close).toHaveBeenLastCalledWith(
      'v2',
      AGENT_ID,
      'REJECTED',
      { evalNote: 'Cota acabou' },
    )
    await SteelAgentVersionService.onEvalFinished(
      finished({ status: 'FAILED', passed: 0, failed: 0 }),
    )
    expect(versions.close).toHaveBeenLastCalledWith(
      'v2',
      AGENT_ID,
      'REJECTED',
      { evalNote: 'A avaliação não terminou.' },
    )
    await SteelAgentVersionService.onEvalFinished(
      finished({ passed: 0, failed: 0 }),
    )
    expect(versions.close).toHaveBeenLastCalledWith(
      'v2',
      AGENT_ID,
      'REJECTED',
      { evalNote: 'Nenhum caso foi avaliado.' },
    )
  })

  it('should leave versions that are not pending alone', async () => {
    versions.findByIdUnscoped.mockResolvedValue(
      ok(version({ status: 'DISCARDED' })),
    )
    await SteelAgentVersionService.onEvalFinished(finished())
    versions.findByIdUnscoped.mockResolvedValue(ok(null))
    await SteelAgentVersionService.onEvalFinished(finished())
    versions.findByIdUnscoped.mockResolvedValue(err(databaseError('x')))
    await SteelAgentVersionService.onEvalFinished(finished())
    expect(versions.update).not.toHaveBeenCalled()
  })

  it('should stop quietly on repository errors and never throw', async () => {
    agents.findById.mockResolvedValue(err(databaseError('x')))
    await SteelAgentVersionService.onEvalFinished(finished())
    agents.findById.mockResolvedValue(ok(agent()))

    versions.update.mockResolvedValue(err(databaseError('x')))
    await SteelAgentVersionService.onEvalFinished(finished())
    versions.update.mockImplementation(async (id, data) =>
      ok(version({ id, ...data })),
    )

    versions.publish.mockResolvedValue(err(databaseError('x')))
    await SteelAgentVersionService.onEvalFinished(finished())
    versions.close.mockResolvedValue(err(databaseError('x')))
    await SteelAgentVersionService.onEvalFinished(
      finished({ passed: 1, failed: 9 }),
    )

    versions.findByIdUnscoped.mockRejectedValue(new Error('boom'))
    await expect(
      SteelAgentVersionService.onEvalFinished(finished()),
    ).resolves.toBeUndefined()
    versions.findByIdUnscoped.mockRejectedValue('weird')
    await expect(
      SteelAgentVersionService.onEvalFinished(finished()),
    ).resolves.toBeUndefined()
  })
})

describe('SteelAgentVersionService gate notifications and simulation chain', () => {
  const evalDone = (over = {}) => ({
    versionId: 'v2',
    evalRunId: 'run1',
    status: 'DONE' as const,
    passed: 9,
    failed: 1,
    error: null,
    ...over,
  })

  beforeEach(() => {
    versions.findByIdUnscoped.mockResolvedValue(
      ok(version({ createdById: 'editor1' })),
    )
  })

  it('should notify the owner when the eval gate publishes', async () => {
    agents.findById.mockResolvedValue(
      ok(agent({ ownerId: 'owner1', name: 'Triagem' })),
    )
    await SteelAgentVersionService.onEvalFinished(evalDone())
    expect(notifyGate).toHaveBeenCalledWith({
      workspaceId: WS,
      agentId: AGENT_ID,
      agentName: 'Triagem',
      ownerId: 'owner1',
      createdById: 'editor1',
      versionId: 'v2',
      number: 2,
      outcome: 'PUBLISHED',
      detail: 'Avaliação: 9 de 10 casos',
    })
  })

  it('should notify the A/B start and a rejection', async () => {
    versions.update.mockResolvedValue(
      ok(
        version({
          rolloutPercent: 20,
          evalRunId: 'run1',
          evalPassed: 9,
          evalTotal: 10,
        }),
      ),
    )
    await SteelAgentVersionService.onEvalFinished(evalDone())
    expect(notifyGate).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: 'CHALLENGER' }),
    )
    versions.update.mockImplementation(async (id, data) =>
      ok(version({ id, ...data })),
    )
    await SteelAgentVersionService.onEvalFinished(
      evalDone({ passed: 1, failed: 9 }),
    )
    expect(notifyGate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        outcome: 'REJECTED',
        detail: 'Passou em 1 de 10 casos (10%); o mínimo é 80%.',
      }),
    )
  })

  it('should start the simulation gate after a passing eval and wait for it', async () => {
    agents.findById.mockResolvedValue(ok(agent({ simGateEnabled: true })))
    await SteelAgentVersionService.onEvalFinished(evalDone())
    expect(sims.create).toHaveBeenCalledWith(
      expect.objectContaining({
        startedById: 'editor1',
        agentVersionId: 'v2',
      }),
    )
    expect(versions.publish).not.toHaveBeenCalled()
    expect(notifyGate).not.toHaveBeenCalled()
  })

  it('should reject when the simulation cannot start after a passing eval', async () => {
    agents.findById.mockResolvedValue(ok(agent({ simGateEnabled: true })))
    sims.latestScenarioSet.mockResolvedValue(ok(null))
    await SteelAgentVersionService.onEvalFinished(evalDone())
    expect(versions.close).toHaveBeenCalledWith('v2', AGENT_ID, 'REJECTED', {
      evalNote: expect.stringContaining(
        'A avaliação passou, mas a simulação não pôde começar',
      ),
    })
    expect(notifyGate).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'REJECTED' }),
    )
  })

  it('should not start the simulation when the eval already failed', async () => {
    agents.findById.mockResolvedValue(ok(agent({ simGateEnabled: true })))
    await SteelAgentVersionService.onEvalFinished(
      evalDone({ passed: 1, failed: 9 }),
    )
    expect(sims.create).not.toHaveBeenCalled()
    expect(versions.close).toHaveBeenCalled()
  })

  describe('onSimulationFinished', () => {
    const simDone = (over = {}) => ({
      versionId: 'v2',
      simulationId: 'sim1',
      status: 'COMPLETED' as const,
      passed: 4,
      failed: 1,
      error: null,
      ...over,
    })

    beforeEach(() => {
      agents.findById.mockResolvedValue(
        ok(
          agent({
            simGateEnabled: true,
            simGateMinPassRate: 0.8,
            ownerId: 'owner1',
          }),
        ),
      )
      versions.findByIdUnscoped.mockResolvedValue(
        ok(version({ evalPassed: 9, evalTotal: 10, createdById: 'editor1' })),
      )
    })

    it('should publish when enough scenarios passed and report both gates', async () => {
      await SteelAgentVersionService.onSimulationFinished(simDone())
      expect(versions.update).toHaveBeenCalledWith('v2', {
        simulationId: 'sim1',
        simPassed: 4,
        simTotal: 5,
      })
      expect(versions.publish).toHaveBeenCalled()
      expect(notifyGate).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'PUBLISHED',
          detail: 'Simulação: 4 de 5 cenários',
        }),
      )
    })

    it('should start the A/B when the version asked for a rollout', async () => {
      versions.update.mockResolvedValue(
        ok(version({ rolloutPercent: 10, simPassed: 5, simTotal: 5 })),
      )
      await SteelAgentVersionService.onSimulationFinished(
        simDone({ passed: 5, failed: 0 }),
      )
      expect(versions.makeChallenger).toHaveBeenCalledWith('v2', AGENT_ID, 10)
    })

    it('should reject under the simulation minimum with a pt-BR note', async () => {
      await SteelAgentVersionService.onSimulationFinished(
        simDone({ passed: 2, failed: 3 }),
      )
      expect(versions.close).toHaveBeenCalledWith('v2', AGENT_ID, 'REJECTED', {
        evalNote:
          'Passou em 2 de 5 cenários da simulação (40%); o mínimo é 80%.',
      })
      expect(versions.publish).not.toHaveBeenCalled()
      expect(notifyGate).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'REJECTED' }),
      )
    })

    it('should reject a simulation that failed, was skipped or judged nothing', async () => {
      await SteelAgentVersionService.onSimulationFinished(
        simDone({
          status: 'SKIPPED',
          passed: 0,
          failed: 0,
          error: 'Cota acabou',
        }),
      )
      expect(versions.close).toHaveBeenLastCalledWith(
        'v2',
        AGENT_ID,
        'REJECTED',
        {
          evalNote: 'A simulação não terminou: Cota acabou',
        },
      )
      await SteelAgentVersionService.onSimulationFinished(
        simDone({ status: 'FAILED', passed: 0, failed: 0 }),
      )
      expect(versions.close).toHaveBeenLastCalledWith(
        'v2',
        AGENT_ID,
        'REJECTED',
        {
          evalNote: 'A simulação não terminou: nenhum cenário foi avaliado.',
        },
      )
      await SteelAgentVersionService.onSimulationFinished(
        simDone({ passed: 0, failed: 0 }),
      )
      expect(versions.close).toHaveBeenLastCalledWith(
        'v2',
        AGENT_ID,
        'REJECTED',
        {
          evalNote: 'Nenhum cenário foi avaliado.',
        },
      )
    })

    it('should leave versions that are not pending alone', async () => {
      versions.findByIdUnscoped.mockResolvedValue(
        ok(version({ status: 'DISCARDED' })),
      )
      await SteelAgentVersionService.onSimulationFinished(simDone())
      versions.findByIdUnscoped.mockResolvedValue(ok(null))
      await SteelAgentVersionService.onSimulationFinished(simDone())
      versions.findByIdUnscoped.mockResolvedValue(err(databaseError('x')))
      await SteelAgentVersionService.onSimulationFinished(simDone())
      expect(versions.update).not.toHaveBeenCalled()
      expect(notifyGate).not.toHaveBeenCalled()
    })

    it('should stop quietly on repository errors and never throw', async () => {
      agents.findById.mockResolvedValue(err(databaseError('x')))
      await SteelAgentVersionService.onSimulationFinished(simDone())
      agents.findById.mockResolvedValue(ok(agent({ simGateEnabled: true })))
      versions.update.mockResolvedValue(err(databaseError('x')))
      await SteelAgentVersionService.onSimulationFinished(simDone())
      versions.update.mockImplementation(async (id, data) =>
        ok(version({ id, ...data })),
      )
      versions.publish.mockResolvedValue(err(databaseError('x')))
      await SteelAgentVersionService.onSimulationFinished(simDone())
      versions.findByIdUnscoped.mockRejectedValue(new Error('boom'))
      await expect(
        SteelAgentVersionService.onSimulationFinished(simDone()),
      ).resolves.toBeUndefined()
      versions.findByIdUnscoped.mockRejectedValue('weird')
      await expect(
        SteelAgentVersionService.onSimulationFinished(simDone()),
      ).resolves.toBeUndefined()
    })
  })
})
