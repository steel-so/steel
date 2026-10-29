import { describe, expect, it } from 'vitest'
import { seedSteelAgentVersion } from '@/src/__tests__/factories/nov-a2-agent-versions.factory'
import {
  seedSteelAgent,
  seedSteelAgentRun,
} from '@/src/__tests__/factories/steel-agent.factory'
import { seedAiPendingAction } from '@/src/__tests__/factories/steel-ai.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SteelAgentVersionRepository } from '../steel-agent-version.repository'

async function context() {
  const [workspace, owner] = await Promise.all([seedWorkspace(), seedUser()])
  const agent = await seedSteelAgent({
    workspaceId: workspace.id,
    ownerId: owner.id,
    tools: [{ toolName: 'sd_list_tickets', mode: 'AUTO' }],
  })
  return { workspace, owner, agent }
}

const draft = (workspaceId: string, agentId: string) => ({
  workspaceId,
  agentId,
  status: 'PENDING_EVAL' as const,
  instructions: 'Nova instrução.',
  maxToolRounds: 5,
  tools: [{ toolName: 'crm_create_task', mode: 'APPROVAL' as const }],
})

describe('SteelAgentVersionRepository', () => {
  it('should number versions per agent and stamp published ones', async () => {
    const { workspace, agent } = await context()
    const other = await seedSteelAgent({ workspaceId: workspace.id })

    const v1 = expectOk(
      await SteelAgentVersionRepository.create({
        ...draft(workspace.id, agent.id),
        status: 'PUBLISHED',
      }),
    )
    const v2 = expectOk(
      await SteelAgentVersionRepository.create(draft(workspace.id, agent.id)),
    )
    const first = expectOk(
      await SteelAgentVersionRepository.create(draft(workspace.id, other.id)),
    )
    expect([v1.number, v2.number, first.number]).toEqual([1, 2, 1])
    expect(v1.publishedAt).toBeInstanceOf(Date)
    expect(v2.publishedAt).toBeNull()

    const listed = expectOk(
      await SteelAgentVersionRepository.listByAgent(agent.id, workspace.id),
    )
    expect(listed.map((v) => v.number)).toEqual([2, 1])
    expect(
      expectOk(
        await SteelAgentVersionRepository.listByAgent(agent.id, 'other-ws'),
      ),
    ).toEqual([])
  })

  it('should find by id scoped to the workspace, and unscoped for the worker', async () => {
    const { workspace, agent } = await context()
    const v = await seedSteelAgentVersion({
      workspaceId: workspace.id,
      agentId: agent.id,
    })
    expect(
      expectOk(await SteelAgentVersionRepository.findById(v.id, workspace.id))
        .id,
    ).toBe(v.id)
    expectErr(
      await SteelAgentVersionRepository.findById(v.id, 'other-ws'),
      'STEEL_AGENT_VERSION_NOT_FOUND',
    )
    expect(
      expectOk(await SteelAgentVersionRepository.findByIdUnscoped(v.id))?.id,
    ).toBe(v.id)
    expect(
      expectOk(await SteelAgentVersionRepository.findByIdUnscoped('nope')),
    ).toBeNull()
  })

  it('should find the pending version and update eval fields', async () => {
    const { workspace, agent } = await context()
    expect(
      expectOk(await SteelAgentVersionRepository.findPending(agent.id)),
    ).toBeNull()
    const pending = expectOk(
      await SteelAgentVersionRepository.create(draft(workspace.id, agent.id)),
    )
    expect(
      expectOk(await SteelAgentVersionRepository.findPending(agent.id))?.id,
    ).toBe(pending.id)
    const updated = expectOk(
      await SteelAgentVersionRepository.update(pending.id, {
        evalRunId: 'run1',
        evalPassed: 3,
        evalTotal: 4,
      }),
    )
    expect(updated).toMatchObject({ evalRunId: 'run1', evalPassed: 3 })
    expectErr(
      await SteelAgentVersionRepository.update('missing', { evalNote: 'x' }),
      'DATABASE_ERROR',
    )
  })

  it('should publish: supersede the old one and mirror the snapshot on the agent', async () => {
    const { workspace, agent } = await context()
    const v1 = await seedSteelAgentVersion({
      workspaceId: workspace.id,
      agentId: agent.id,
    })
    await prisma.steelAgent.update({
      where: { id: agent.id },
      data: { publishedVersionId: v1.id },
    })
    const v2 = expectOk(
      await SteelAgentVersionRepository.create({
        ...draft(workspace.id, agent.id),
        rolloutPercent: 30,
      }),
    )
    await prisma.steelAgent.update({
      where: { id: agent.id },
      data: { challengerVersionId: v2.id },
    })

    const published = expectOk(
      await SteelAgentVersionRepository.publish(v2, [
        { toolName: 'crm_create_task', mode: 'APPROVAL' },
        { toolName: 'sd_get_ticket', mode: 'AUTO' },
      ]),
    )
    expect(published).toMatchObject({
      status: 'PUBLISHED',
      rolloutPercent: null,
    })
    const old = await prisma.steelAgentVersion.findUniqueOrThrow({
      where: { id: v1.id },
    })
    expect(old.status).toBe('SUPERSEDED')
    expect(old.resolvedAt).toBeInstanceOf(Date)

    const row = await prisma.steelAgent.findUniqueOrThrow({
      where: { id: agent.id },
      include: { tools: { orderBy: { toolName: 'asc' } } },
    })
    expect(row).toMatchObject({
      instructions: 'Nova instrução.',
      maxToolRounds: 5,
      publishedVersionId: v2.id,
      challengerVersionId: null,
    })
    expect(row.tools.map((t) => t.toolName)).toEqual([
      'crm_create_task',
      'sd_get_ticket',
    ])
  })

  it('should publish a version with no tools and keep an unrelated challenger', async () => {
    const { workspace, agent } = await context()
    const challenger = await seedSteelAgentVersion({
      workspaceId: workspace.id,
      agentId: agent.id,
      status: 'CHALLENGER',
      rolloutPercent: 10,
    })
    await prisma.steelAgent.update({
      where: { id: agent.id },
      data: { challengerVersionId: challenger.id },
    })
    const v = expectOk(
      await SteelAgentVersionRepository.create({
        ...draft(workspace.id, agent.id),
        tools: [],
      }),
    )
    expectOk(await SteelAgentVersionRepository.publish(v, []))
    const row = await prisma.steelAgent.findUniqueOrThrow({
      where: { id: agent.id },
      include: { tools: true },
    })
    expect(row.tools).toEqual([])
    expect(row.challengerVersionId).toBe(challenger.id)
  })

  it('should make a challenger, discarding the previous one', async () => {
    const { workspace, agent } = await context()
    const a = expectOk(
      await SteelAgentVersionRepository.create(draft(workspace.id, agent.id)),
    )
    const b = expectOk(
      await SteelAgentVersionRepository.create(draft(workspace.id, agent.id)),
    )
    expectOk(
      await SteelAgentVersionRepository.makeChallenger(a.id, agent.id, 20),
    )
    const second = expectOk(
      await SteelAgentVersionRepository.makeChallenger(b.id, agent.id, 40),
    )
    expect(second).toMatchObject({ status: 'CHALLENGER', rolloutPercent: 40 })
    const first = await prisma.steelAgentVersion.findUniqueOrThrow({
      where: { id: a.id },
    })
    expect(first.status).toBe('DISCARDED')
    expect(
      (
        await prisma.steelAgent.findUniqueOrThrow({
          where: { id: agent.id },
        })
      ).challengerVersionId,
    ).toBe(b.id)
  })

  it('should close a version and clear the challenger pointer', async () => {
    const { workspace, agent } = await context()
    const v = expectOk(
      await SteelAgentVersionRepository.create(draft(workspace.id, agent.id)),
    )
    expectOk(
      await SteelAgentVersionRepository.makeChallenger(v.id, agent.id, 20),
    )
    const closed = expectOk(
      await SteelAgentVersionRepository.close(v.id, agent.id, 'REJECTED', {
        evalNote: 'Abaixo do mínimo',
      }),
    )
    expect(closed).toMatchObject({
      status: 'REJECTED',
      evalNote: 'Abaixo do mínimo',
    })
    expect(closed.resolvedAt).toBeInstanceOf(Date)
    expect(
      (await prisma.steelAgent.findUniqueOrThrow({ where: { id: agent.id } }))
        .challengerVersionId,
    ).toBeNull()
    expectErr(
      await SteelAgentVersionRepository.close('missing', agent.id, 'DISCARDED'),
      'DATABASE_ERROR',
    )
  })

  it('should set the published pointer', async () => {
    const { workspace, agent } = await context()
    const v = await seedSteelAgentVersion({
      workspaceId: workspace.id,
      agentId: agent.id,
    })
    expectOk(
      await SteelAgentVersionRepository.setPublishedPointer(agent.id, v.id),
    )
    expect(
      (await prisma.steelAgent.findUniqueOrThrow({ where: { id: agent.id } }))
        .publishedVersionId,
    ).toBe(v.id)
    expectErr(
      await SteelAgentVersionRepository.setPublishedPointer('missing', v.id),
      'DATABASE_ERROR',
    )
  })

  it('should return real-run rows only, with the approvals of their runs', async () => {
    const { workspace, agent } = await context()
    const v = await seedSteelAgentVersion({
      workspaceId: workspace.id,
      agentId: agent.id,
    })
    const real = await seedSteelAgentRun({
      workspaceId: workspace.id,
      agentId: agent.id,
      status: 'SUCCEEDED',
      versionId: v.id,
      rounds: 3,
    })
    await seedSteelAgentRun({
      workspaceId: workspace.id,
      agentId: agent.id,
      isTest: true,
      versionId: v.id,
    })
    await seedSteelAgentRun({ workspaceId: workspace.id, agentId: agent.id })
    await seedAiPendingAction(workspace.id, {
      agentRunId: real.id,
      status: 'EXECUTED',
    })

    const rows = expectOk(await SteelAgentVersionRepository.statsRows(agent.id))
    expect(rows.runs).toEqual([
      { versionId: v.id, status: 'SUCCEEDED', costUsd: 0, rounds: 3 },
    ])
    expect(rows.approvals).toEqual([{ versionId: v.id, status: 'EXECUTED' }])
  })
})
