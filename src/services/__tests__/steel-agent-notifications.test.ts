import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/services/notification-emitter', () => ({
  emitNotification: vi.fn(async () => 1),
  workspaceAdminIds: vi.fn(async () => ['admin1', 'admin2']),
}))

import {
  emitNotification,
  workspaceAdminIds,
} from '@/src/services/notification-emitter'
import {
  notifyAgentApprovalRequested,
  notifyAgentRunFailed,
  notifyAgentSimulationFinished,
  notifyAgentVersionGateFinished,
  steelAgentRunPath,
  steelAgentSimulationPath,
  steelAgentVersionsPath,
} from '../steel-agent-notifications'

const emit = vi.mocked(emitNotification)

beforeEach(() => {
  vi.mocked(workspaceAdminIds).mockResolvedValue(['admin1', 'admin2'])
  emit.mockResolvedValue(1)
})

describe('steel agent notifications', () => {
  it('should build the run path', () => {
    expect(steelAgentRunPath('a1', 'r1')).toBe('/ai/agents/a1/runs/r1')
  })

  it('should notify owner and admins about a pending approval', async () => {
    await notifyAgentApprovalRequested({
      workspaceId: 'ws1',
      agentId: 'a1',
      agentName: 'Triagem',
      ownerId: 'owner1',
      runId: 'r1',
      round: 2,
      count: 1,
    })
    expect(emit).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      recipients: ['owner1', 'admin1', 'admin2'],
      kind: 'AGENT_APPROVAL_REQUESTED',
      title: 'Triagem aguarda aprovação',
      body: 'O agente propôs uma ação que precisa da sua aprovação.',
      path: '/ai/agents/a1/runs/r1',
      dedupeKey: 'agent-approval:r1:2',
    })
  })

  it('should pluralize several pending approvals', async () => {
    await notifyAgentApprovalRequested({
      workspaceId: 'ws1',
      agentId: 'a1',
      agentName: 'Triagem',
      ownerId: null,
      runId: 'r1',
      round: 1,
      count: 3,
    })
    expect(emit.mock.calls[0][0].body).toBe(
      'O agente propôs 3 ações que precisam da sua aprovação.',
    )
  })

  it('should notify owner and creator about a failure', async () => {
    await notifyAgentRunFailed({
      workspaceId: 'ws1',
      agentId: 'a1',
      agentName: 'Triagem',
      ownerId: 'owner1',
      createdById: 'admin1',
      runId: 'r1',
      error: 'x'.repeat(400),
    })
    const input = emit.mock.calls[0][0]
    expect(input.kind).toBe('AGENT_RUN_FAILED')
    expect(input.recipients).toEqual(['owner1', 'admin1'])
    expect(input.body).toHaveLength(280)
    expect(input.dedupeKey).toBe('agent-run-failed:r1')
  })
})

describe('steel agent version gate and simulation notices', () => {
  const gate = {
    workspaceId: 'ws1',
    agentId: 'a1',
    agentName: 'Triagem',
    ownerId: 'owner1',
    createdById: 'editor1',
    versionId: 'v2',
    number: 2,
  }

  it('should build the deep links', () => {
    expect(steelAgentVersionsPath('a1')).toBe('/ai/agents/a1?tab=versions')
    expect(steelAgentSimulationPath('a1', 's1')).toBe(
      '/ai/agents/a1/simulations/s1',
    )
  })

  it.each([
    ['PUBLISHED', 'Triagem: versão 2 publicada'],
    ['CHALLENGER', 'Triagem: versão 2 em teste A/B'],
    ['REJECTED', 'Triagem: versão 2 reprovada na avaliação'],
  ] as const)(
    'should notify owner and editor when the gate ends as %s',
    async (outcome, title) => {
      await notifyAgentVersionGateFinished({
        ...gate,
        outcome,
        detail: 'x'.repeat(400),
      })
      const input = emit.mock.calls[emit.mock.calls.length - 1][0]
      expect(input).toMatchObject({
        workspaceId: 'ws1',
        recipients: ['owner1', 'editor1'],
        kind: 'AGENT_VERSION_GATE_FINISHED',
        title,
        path: '/ai/agents/a1?tab=versions',
        dedupeKey: 'agent-version-gate:v2',
      })
      expect(input.body).toHaveLength(280)
    },
  )

  const sim = {
    workspaceId: 'ws1',
    agentId: 'a1',
    agentName: 'Triagem',
    ownerId: 'owner1',
    startedById: 'starter',
    simulationId: 's1',
    passed: 3,
    failed: 1,
    avgScore: 82,
    error: null,
  }

  it('should summarize a completed simulation', async () => {
    await notifyAgentSimulationFinished({ ...sim, status: 'COMPLETED' })
    expect(emit).toHaveBeenLastCalledWith({
      workspaceId: 'ws1',
      recipients: ['owner1', 'starter'],
      kind: 'AGENT_SIMULATION_FINISHED',
      title: 'Triagem: simulação concluída',
      body: '3 de 4 cenários passaram (nota média 82).',
      path: '/ai/agents/a1/simulations/s1',
      dedupeKey: 'agent-simulation:s1',
    })
  })

  it('should omit the score when nothing was graded', async () => {
    await notifyAgentSimulationFinished({
      ...sim,
      status: 'COMPLETED',
      avgScore: null,
    })
    expect(emit.mock.calls[emit.mock.calls.length - 1][0].body).toBe(
      '3 de 4 cenários passaram.',
    )
  })

  it('should explain a failed or skipped simulation', async () => {
    await notifyAgentSimulationFinished({
      ...sim,
      status: 'SKIPPED',
      error: 'A cota mensal de IA do workspace acabou.',
    })
    let input = emit.mock.calls[emit.mock.calls.length - 1][0]
    expect(input.title).toBe('Triagem: simulação não rodou')
    expect(input.body).toBe('A cota mensal de IA do workspace acabou.')

    await notifyAgentSimulationFinished({ ...sim, status: 'FAILED' })
    input = emit.mock.calls[emit.mock.calls.length - 1][0]
    expect(input.title).toBe('Triagem: simulação falhou')
    expect(input.body).toBe('Nenhum cenário foi avaliado.')
  })
})
