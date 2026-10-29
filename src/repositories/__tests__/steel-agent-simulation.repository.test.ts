import { describe, expect, it, vi } from 'vitest'
import { seedSimulation } from '@/src/__tests__/factories/nov-a3-persona-simulation.factory'
import { seedSteelAgent } from '@/src/__tests__/factories/steel-agent.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  STALE_AFTER_MS,
  SteelAgentSimulationCaseRepository,
  SteelAgentSimulationRepository,
} from '../steel-agent-simulation.repository'

async function context() {
  const [workspace, owner] = await Promise.all([seedWorkspace(), seedUser()])
  const agent = await seedSteelAgent({
    workspaceId: workspace.id,
    ownerId: owner.id,
    tools: [{ toolName: 'sd_list_tickets', mode: 'AUTO' }],
  })
  return { workspace, owner, agent }
}

const caseInput = (label: string) => ({
  label,
  personaKey: null,
  persona: 'Cliente sem paciência',
  scenario: 'Internet fora',
  channel: 'WHATSAPP',
  openingMessage: 'Cadê minha internet?',
  criteria: ['Reconhece o problema'],
  maxTurns: 4,
})

describe('SteelAgentSimulationRepository', () => {
  it('should create the simulation with ordered cases', async () => {
    const { workspace, owner, agent } = await context()
    const created = expectOk(
      await SteelAgentSimulationRepository.create({
        workspaceId: workspace.id,
        agentId: agent.id,
        name: 'Antes de ativar',
        startedById: owner.id,
        passScore: 80,
        cases: [caseInput('A'), caseInput('B')],
      }),
    )
    expect(created).toMatchObject({
      status: 'QUEUED',
      totalCases: 2,
      passScore: 80,
    })
    expect(created.cases.map((c) => [c.position, c.label])).toEqual([
      [0, 'A'],
      [1, 'B'],
    ])
    expect(created.cases[0].criteria).toEqual(['Reconhece o problema'])
  })

  it('should find the detail scoped by workspace', async () => {
    const { workspace, agent } = await context()
    const seeded = await seedSimulation({
      workspaceId: workspace.id,
      agentId: agent.id,
      cases: [{ label: 'B' }, { label: 'A' }],
    })
    const detail = expectOk(
      await SteelAgentSimulationRepository.findDetail(seeded.id, workspace.id),
    )
    expect(detail.agent.id).toBe(agent.id)
    expect(detail.cases.map((c) => c.label)).toEqual(['B', 'A'])

    expectErr(
      await SteelAgentSimulationRepository.findDetail(seeded.id, 'other-ws'),
      'STEEL_AGENT_SIMULATION_NOT_FOUND',
    )
  })

  it('should load a simulation for execution with the agent tools', async () => {
    const { workspace, agent } = await context()
    const seeded = await seedSimulation({
      workspaceId: workspace.id,
      agentId: agent.id,
    })
    const loaded = expectOk(
      await SteelAgentSimulationRepository.findForExecution(seeded.id),
    )
    expect(loaded.agent.tools.map((t) => t.toolName)).toEqual([
      'sd_list_tickets',
    ])
    expect(loaded.cases).toHaveLength(1)
    expectErr(
      await SteelAgentSimulationRepository.findForExecution('missing'),
      'STEEL_AGENT_SIMULATION_NOT_FOUND',
    )
  })

  it('should list the newest simulations of an agent first', async () => {
    const { workspace, agent } = await context()
    const older = await seedSimulation({
      workspaceId: workspace.id,
      agentId: agent.id,
      name: 'older',
    })
    const newer = await seedSimulation({
      workspaceId: workspace.id,
      agentId: agent.id,
      name: 'newer',
    })
    const other = await context()
    await seedSimulation({
      workspaceId: other.workspace.id,
      agentId: other.agent.id,
    })

    const list = expectOk(
      await SteelAgentSimulationRepository.listByAgent(agent.id, 10),
    )
    expect(list.map((s) => s.id)).toEqual([newer.id, older.id])
    expect(
      expectOk(await SteelAgentSimulationRepository.listByAgent(agent.id, 1)),
    ).toHaveLength(1)
  })

  it('should detect an active simulation, ignoring finished and stale ones', async () => {
    const { workspace, agent } = await context()
    expect(
      expectOk(await SteelAgentSimulationRepository.hasActive(agent.id)),
    ).toBe(false)

    await seedSimulation({
      workspaceId: workspace.id,
      agentId: agent.id,
      status: 'COMPLETED',
    })
    expect(
      expectOk(await SteelAgentSimulationRepository.hasActive(agent.id)),
    ).toBe(false)

    await seedSimulation({
      workspaceId: workspace.id,
      agentId: agent.id,
      status: 'RUNNING',
      updatedAt: new Date(Date.now() - STALE_AFTER_MS - 60_000),
    })
    expect(
      expectOk(await SteelAgentSimulationRepository.hasActive(agent.id)),
    ).toBe(false)

    await seedSimulation({
      workspaceId: workspace.id,
      agentId: agent.id,
      status: 'QUEUED',
    })
    expect(
      expectOk(await SteelAgentSimulationRepository.hasActive(agent.id)),
    ).toBe(true)
  })

  it('should let only one caller claim a queued simulation', async () => {
    const { workspace, agent } = await context()
    const seeded = await seedSimulation({
      workspaceId: workspace.id,
      agentId: agent.id,
    })
    expect(
      expectOk(
        await SteelAgentSimulationRepository.claim(seeded.id, ['QUEUED'], {
          status: 'RUNNING',
        }),
      ),
    ).toBe(true)
    expect(
      expectOk(
        await SteelAgentSimulationRepository.claim(seeded.id, ['QUEUED'], {
          status: 'RUNNING',
        }),
      ),
    ).toBe(false)
  })

  it('should update and delete (cascading to the cases)', async () => {
    const { workspace, agent } = await context()
    const seeded = await seedSimulation({
      workspaceId: workspace.id,
      agentId: agent.id,
      cases: [{}, {}],
    })
    const updated = expectOk(
      await SteelAgentSimulationRepository.update(seeded.id, {
        status: 'COMPLETED',
        avgScore: 88,
      }),
    )
    expect(updated).toMatchObject({ status: 'COMPLETED', avgScore: 88 })

    expectOk(await SteelAgentSimulationRepository.delete(seeded.id))
    expect(
      await prisma.steelAgentSimulationCase.count({
        where: { simulationId: seeded.id },
      }),
    ).toBe(0)
  })

  it('should cascade when the agent is deleted', async () => {
    const { workspace, agent } = await context()
    const seeded = await seedSimulation({
      workspaceId: workspace.id,
      agentId: agent.id,
    })
    await prisma.steelAgent.delete({ where: { id: agent.id } })
    expect(
      await prisma.steelAgentSimulation.findUnique({
        where: { id: seeded.id },
      }),
    ).toBeNull()
  })

  it('should return database errors as Result errors', async () => {
    const spy = vi
      .spyOn(prisma.steelAgentSimulation, 'findFirst')
      .mockRejectedValueOnce(new Error('db down'))
    expectErr(
      await SteelAgentSimulationRepository.findDetail('x', 'y'),
      'DATABASE_ERROR',
    )
    spy.mockRestore()

    for (const [method, run] of [
      [
        'create',
        () =>
          SteelAgentSimulationRepository.create({
            workspaceId: 'w',
            agentId: 'a',
            name: 'n',
            startedById: 'u',
            passScore: 70,
            cases: [],
          }),
      ],
      [
        'findUnique',
        () => SteelAgentSimulationRepository.findForExecution('x'),
      ],
      ['findMany', () => SteelAgentSimulationRepository.listByAgent('x', 1)],
      ['count', () => SteelAgentSimulationRepository.hasActive('x')],
      [
        'updateMany',
        () => SteelAgentSimulationRepository.claim('x', ['QUEUED'], {}),
      ],
      ['update', () => SteelAgentSimulationRepository.update('x', {})],
      ['delete', () => SteelAgentSimulationRepository.delete('x')],
    ] as const) {
      const failing = vi
        .spyOn(prisma.steelAgentSimulation, method)
        .mockRejectedValueOnce(new Error('db down'))
      expectErr(await run(), 'DATABASE_ERROR')
      failing.mockRestore()
    }
  })
})

describe('SteelAgentSimulationCaseRepository', () => {
  it('should update a case', async () => {
    const { workspace, agent } = await context()
    const seeded = await seedSimulation({
      workspaceId: workspace.id,
      agentId: agent.id,
    })
    const updated = expectOk(
      await SteelAgentSimulationCaseRepository.update(seeded.cases[0].id, {
        status: 'DONE',
        verdict: 'PASS',
        score: 91,
        transcript: [{ role: 'customer', text: 'Oi' }],
      }),
    )
    expect(updated).toMatchObject({
      status: 'DONE',
      verdict: 'PASS',
      score: 91,
    })
    expect(updated.transcript).toEqual([{ role: 'customer', text: 'Oi' }])
  })

  it('should fail only the unfinished cases', async () => {
    const { workspace, agent } = await context()
    const seeded = await seedSimulation({
      workspaceId: workspace.id,
      agentId: agent.id,
      cases: [{ status: 'QUEUED' }, { status: 'RUNNING' }, { status: 'DONE' }],
    })
    expect(
      expectOk(
        await SteelAgentSimulationCaseRepository.failUnfinished(
          seeded.id,
          'sem cota',
        ),
      ),
    ).toBe(2)
    const rows = await prisma.steelAgentSimulationCase.findMany({
      where: { simulationId: seeded.id },
      orderBy: { position: 'asc' },
    })
    expect(rows.map((r) => r.status)).toEqual(['FAILED', 'FAILED', 'DONE'])
    expect(rows[0].error).toBe('sem cota')
  })

  it('should return database errors as Result errors', async () => {
    const update = vi
      .spyOn(prisma.steelAgentSimulationCase, 'update')
      .mockRejectedValueOnce(new Error('db down'))
    expectErr(
      await SteelAgentSimulationCaseRepository.update('x', {}),
      'DATABASE_ERROR',
    )
    update.mockRestore()
    const many = vi
      .spyOn(prisma.steelAgentSimulationCase, 'updateMany')
      .mockRejectedValueOnce(new Error('db down'))
    expectErr(
      await SteelAgentSimulationCaseRepository.failUnfinished('x', 'e'),
      'DATABASE_ERROR',
    )
    many.mockRestore()
  })
})
