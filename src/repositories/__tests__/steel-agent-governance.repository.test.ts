import { describe, expect, it } from 'vitest'
import { createSteelMcpServer } from '@/src/__tests__/factories/nov-ai-governance.factory'
import {
  seedSteelAgent,
  seedSteelAgentRun,
} from '@/src/__tests__/factories/steel-agent.factory'
import { seedAiPendingAction } from '@/src/__tests__/factories/steel-ai.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  SteelAgentDelegateRepository,
  SteelAgentRepository,
  SteelAgentRunRepository,
} from '../steel-agent.repository'
import {
  SteelAgentGovernanceMetricsRepository,
  SteelAgentPolicyRepository,
} from '../steel-agent-governance.repository'
import { SteelMcpServerRepository } from '../steel-mcp-server.repository'

const NOW = new Date('2026-10-30T12:00:00.000Z')
const SINCE = new Date('2026-01-01T00:00:00.000Z')

async function context() {
  const [workspace, owner] = await Promise.all([seedWorkspace(), seedUser()])
  return { workspace, owner }
}

describe('SteelAgentPolicyRepository', () => {
  it('should save rules and read them back', async () => {
    const { workspace, owner } = await context()
    expect(
      expectOk(await SteelAgentPolicyRepository.find(workspace.id)),
    ).toBeNull()

    const saved = expectOk(
      await SteelAgentPolicyRepository.saveRules(workspace.id, owner.id, {
        restrictCreators: true,
        creatorRoles: ['MEMBER'],
        restrictAuto: true,
        autoRules: { MEMBER: { mode: 'NONE', tools: [] } },
      }),
    )
    expect(saved).toEqual(
      expect.objectContaining({
        restrictCreators: true,
        creatorRoles: ['MEMBER'],
        updatedById: owner.id,
      }),
    )
    const again = expectOk(
      await SteelAgentPolicyRepository.saveRules(workspace.id, owner.id, {
        restrictCreators: false,
        creatorRoles: [],
        restrictAuto: false,
        autoRules: null,
      }),
    )
    expect(again.restrictCreators).toBe(false)
    expect(again.autoRules).toBeNull()
    expect(await prisma.steelAgentPolicy.count()).toBe(1)
  })

  it('should kill idempotently, keeping the first reason, and resume', async () => {
    const { workspace, owner } = await context()
    const first = expectOk(
      await SteelAgentPolicyRepository.kill(workspace.id, owner.id, 'Um', NOW),
    )
    expect(first.killedAt).toEqual(NOW)
    const second = expectOk(
      await SteelAgentPolicyRepository.kill(
        workspace.id,
        owner.id,
        'Dois',
        new Date(NOW.getTime() + 1000),
      ),
    )
    expect(second.killReason).toBe('Um')
    expect(second.killedAt).toEqual(NOW)

    const resumed = expectOk(
      await SteelAgentPolicyRepository.resume(workspace.id, owner.id),
    )
    expect(resumed?.killedAt).toBeNull()
    expect(resumed?.killReason).toBeNull()
    expect(
      expectOk(await SteelAgentPolicyRepository.resume(workspace.id, owner.id)),
    ).toBeNull()

    // A kill after saved rules keeps the rules.
    await SteelAgentPolicyRepository.saveRules(workspace.id, owner.id, {
      restrictCreators: true,
      creatorRoles: [],
      restrictAuto: false,
      autoRules: null,
    })
    const killed = expectOk(
      await SteelAgentPolicyRepository.kill(workspace.id, owner.id, null, NOW),
    )
    expect(killed.restrictCreators).toBe(true)
  })

  it('should cancel queued runs and pending actions of the workspace only', async () => {
    const { workspace, owner } = await context()
    const other = await context()
    const agent = await seedSteelAgent({
      workspaceId: workspace.id,
      ownerId: owner.id,
    })
    const otherAgent = await seedSteelAgent({
      workspaceId: other.workspace.id,
      ownerId: other.owner.id,
    })
    const queued = await seedSteelAgentRun({
      workspaceId: workspace.id,
      agentId: agent.id,
      status: 'QUEUED',
    })
    const waiting = await seedSteelAgentRun({
      workspaceId: workspace.id,
      agentId: agent.id,
      status: 'WAITING_APPROVAL',
    })
    const done = await seedSteelAgentRun({
      workspaceId: workspace.id,
      agentId: agent.id,
      status: 'SUCCEEDED',
    })
    const foreign = await seedSteelAgentRun({
      workspaceId: other.workspace.id,
      agentId: otherAgent.id,
      status: 'QUEUED',
    })
    const action = await seedAiPendingAction(workspace.id, {
      agentRunId: waiting.id,
      status: 'PENDING',
    })
    const chatAction = await seedAiPendingAction(workspace.id, {
      requestedById: owner.id,
      status: 'PENDING',
    })

    const counts = expectOk(
      await SteelAgentPolicyRepository.cancelInFlight(
        workspace.id,
        NOW,
        'Pausado',
      ),
    )
    expect(counts).toEqual({ runs: 2, actions: 1 })

    const status = async (id: string) =>
      (await prisma.steelAgentRun.findUniqueOrThrow({ where: { id } })).status
    expect(await status(queued.id)).toBe('SKIPPED')
    expect(await status(waiting.id)).toBe('SKIPPED')
    expect(await status(done.id)).toBe('SUCCEEDED')
    expect(await status(foreign.id)).toBe('QUEUED')
    const run = await prisma.steelAgentRun.findUniqueOrThrow({
      where: { id: queued.id },
    })
    expect(run.summary).toBe('Pausado')
    expect(run.finishedAt).toEqual(NOW)
    const decided = (id: string) =>
      prisma.aiPendingAction.findUniqueOrThrow({ where: { id } })
    expect((await decided(action.id)).status).toBe('CANCELED')
    expect((await decided(chatAction.id)).status).toBe('PENDING')
  })
})

describe('SteelAgentGovernanceMetricsRepository', () => {
  it('should aggregate runs per agent without counting tests, and split delegated cost', async () => {
    const { workspace, owner } = await context()
    const agent = await seedSteelAgent({
      workspaceId: workspace.id,
      ownerId: owner.id,
    })
    const seed = (overrides: Record<string, unknown>) =>
      seedSteelAgentRun({
        workspaceId: workspace.id,
        agentId: agent.id,
        ...overrides,
      })
    await seed({ status: 'SUCCEEDED', costUsd: 1 })
    await seed({ status: 'SUCCEEDED', costUsd: 2, delegatedCostUsd: 0.5 })
    await seed({ status: 'FAILED', costUsd: 0.25 })
    await seed({ status: 'SKIPPED', costUsd: 0 })
    await seed({ status: 'SUCCEEDED', costUsd: 99, isTest: true })

    const rows = expectOk(
      await SteelAgentGovernanceMetricsRepository.runs(workspace.id, SINCE),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(
      expect.objectContaining({
        agentId: agent.id,
        runs: 4,
        succeeded: 2,
        failed: 1,
        skipped: 1,
        delegatedCostUsd: 0.5,
      }),
    )
    expect(rows[0].costUsd).toBeCloseTo(2.75)
    expect(rows[0].lastRunAt).toBeInstanceOf(Date)

    const future = expectOk(
      await SteelAgentGovernanceMetricsRepository.runs(
        workspace.id,
        new Date('2100-01-01'),
      ),
    )
    expect(future).toEqual([])
  })

  it('should count decisions per status, ignoring tests and other workspaces', async () => {
    const { workspace, owner } = await context()
    const agent = await seedSteelAgent({
      workspaceId: workspace.id,
      ownerId: owner.id,
    })
    const run = await seedSteelAgentRun({
      workspaceId: workspace.id,
      agentId: agent.id,
    })
    const testRun = await seedSteelAgentRun({
      workspaceId: workspace.id,
      agentId: agent.id,
      isTest: true,
    })
    for (const status of [
      'EXECUTED',
      'EXECUTED',
      'FAILED',
      'CANCELED',
      'EXPIRED',
      'PENDING',
    ] as const) {
      await seedAiPendingAction(workspace.id, {
        agentRunId: run.id,
        status,
      })
    }
    await seedAiPendingAction(workspace.id, {
      agentRunId: testRun.id,
      status: 'EXECUTED',
    })

    const rows = expectOk(
      await SteelAgentGovernanceMetricsRepository.decisions(
        workspace.id,
        SINCE,
      ),
    )
    expect(rows).toEqual([
      {
        agentId: agent.id,
        executed: 2,
        failed: 1,
        rejected: 1,
        expired: 1,
        pending: 1,
      },
    ])
  })

  it('should count the writes that went through per agent', async () => {
    const { workspace, owner } = await context()
    const agent = await seedSteelAgent({
      workspaceId: workspace.id,
      ownerId: owner.id,
    })
    const log = (outcome: string, source: 'AGENT' | 'ASSISTANT' = 'AGENT') =>
      prisma.aiActionLog.create({
        data: {
          workspaceId: workspace.id,
          source,
          agentId: source === 'AGENT' ? agent.id : null,
          toolName: 'crm_create_task',
          kind: 'CREATE',
          args: {},
          outcome,
        },
      })
    await log('success')
    await log('success')
    await log('failure')
    await log('simulated')
    await log('success', 'ASSISTANT')

    const rows = expectOk(
      await SteelAgentGovernanceMetricsRepository.impact(workspace.id, SINCE),
    )
    expect(rows).toEqual([{ agentId: agent.id, applied: 2 }])
  })
})

describe('SteelAgentDelegateRepository', () => {
  it('should store delegates on create/update and list the targets', async () => {
    const { workspace, owner } = await context()
    const a = await seedSteelAgent({
      workspaceId: workspace.id,
      ownerId: owner.id,
    })
    const b = await seedSteelAgent({
      workspaceId: workspace.id,
      ownerId: owner.id,
      name: 'B',
      enabled: false,
    })
    const c = await seedSteelAgent({
      workspaceId: workspace.id,
      ownerId: owner.id,
      name: 'C',
    })
    expectOk(
      await SteelAgentRepository.update(a.id, {}, undefined, [b.id, c.id]),
    )
    const targets = expectOk(
      await SteelAgentDelegateRepository.listTargets(a.id),
    )
    expect(targets.map((t) => [t.name, t.enabled])).toEqual([
      ['B', false],
      ['C', true],
    ])
    const read = expectOk(
      await SteelAgentRepository.findById(a.id, workspace.id),
    )
    expect(read.delegates.map((d) => d.targetAgentId).sort()).toEqual(
      [b.id, c.id].sort(),
    )

    expectOk(await SteelAgentRepository.update(a.id, {}, undefined, [c.id]))
    expect(
      expectOk(await SteelAgentDelegateRepository.listTargets(a.id)),
    ).toHaveLength(1)
    expectOk(await SteelAgentRepository.update(a.id, {}, undefined, []))
    expect(
      expectOk(await SteelAgentDelegateRepository.listTargets(a.id)),
    ).toEqual([])
    // Leaving `delegateIds` out keeps what is there.
    expectOk(await SteelAgentRepository.update(a.id, {}, undefined, [b.id]))
    expectOk(await SteelAgentRepository.update(a.id, { name: 'A2' }))
    expect(
      expectOk(await SteelAgentDelegateRepository.listTargets(a.id)),
    ).toHaveLength(1)
  })

  it('should create an agent with delegates', async () => {
    const { workspace, owner } = await context()
    const target = await seedSteelAgent({
      workspaceId: workspace.id,
      ownerId: owner.id,
    })
    const created = expectOk(
      await SteelAgentRepository.create({
        name: 'Orquestrador',
        description: null,
        instructions: 'x',
        triggerType: 'MANUAL',
        cron: null,
        timezone: 'America/Sao_Paulo',
        eventKey: null,
        enabled: true,
        ownerId: owner.id,
        maxToolRounds: 8,
        monthlyRunCap: null,
        nextRunAt: null,
        workspaceId: workspace.id,
        createdById: owner.id,
        tools: [],
        delegateIds: [target.id],
      }),
    )
    expect(created.delegates).toEqual([{ targetAgentId: target.id }])
  })

  it('should validate ids against the workspace and expose the graph edges', async () => {
    const { workspace, owner } = await context()
    const other = await context()
    const a = await seedSteelAgent({
      workspaceId: workspace.id,
      ownerId: owner.id,
    })
    const b = await seedSteelAgent({
      workspaceId: workspace.id,
      ownerId: owner.id,
    })
    const foreign = await seedSteelAgent({
      workspaceId: other.workspace.id,
      ownerId: other.owner.id,
    })
    expect(
      expectOk(
        await SteelAgentDelegateRepository.existingInWorkspace(workspace.id, [
          a.id,
          foreign.id,
          'ghost',
        ]),
      ),
    ).toEqual([a.id])
    expect(
      expectOk(
        await SteelAgentDelegateRepository.existingInWorkspace(
          workspace.id,
          [],
        ),
      ),
    ).toEqual([])
    await SteelAgentRepository.update(a.id, {}, undefined, [b.id])
    await SteelAgentRepository.update(foreign.id, {}, undefined, [])
    expect(
      expectOk(await SteelAgentDelegateRepository.edges(workspace.id)),
    ).toEqual([{ agentId: a.id, targetAgentId: b.id }])
    expect(
      expectOk(await SteelAgentDelegateRepository.edges(other.workspace.id)),
    ).toEqual([])
  })

  it('should walk the run chain from the root down', async () => {
    const { workspace, owner } = await context()
    const a = await seedSteelAgent({
      workspaceId: workspace.id,
      ownerId: owner.id,
    })
    const b = await seedSteelAgent({
      workspaceId: workspace.id,
      ownerId: owner.id,
    })
    const root = await seedSteelAgentRun({
      workspaceId: workspace.id,
      agentId: a.id,
    })
    const child = await seedSteelAgentRun({
      workspaceId: workspace.id,
      agentId: b.id,
      parentRunId: root.id,
      depth: 1,
    })
    expect(
      expectOk(await SteelAgentDelegateRepository.runChain(child.id)),
    ).toEqual([a.id, b.id])
    expect(
      expectOk(await SteelAgentDelegateRepository.runChain(root.id)),
    ).toEqual([a.id])
    expect(
      expectOk(await SteelAgentDelegateRepository.runChain('missing')),
    ).toEqual([])
  })

  it('should create a delegated run with parent and depth', async () => {
    const { workspace, owner } = await context()
    const a = await seedSteelAgent({
      workspaceId: workspace.id,
      ownerId: owner.id,
    })
    const run = expectOk(
      await SteelAgentRunRepository.create({
        workspaceId: workspace.id,
        agentId: a.id,
        triggerType: 'MANUAL',
        parentRunId: 'parent1',
        depth: 2,
      }),
    )
    expect(run.parentRunId).toBe('parent1')
    expect(run.depth).toBe(2)
    expect(Number(run.delegatedCostUsd)).toBe(0)
  })
})

describe('SteelMcpServerRepository', () => {
  it('should create, scope by workspace, update and delete', async () => {
    const { workspace } = await context()
    const other = await context()
    const server = await createSteelMcpServer(workspace.id, {
      encryptedAuthValue: 'cipher',
    })
    await createSteelMcpServer(other.workspace.id, { slug: 'other' })

    const list = expectOk(
      await SteelMcpServerRepository.listByWorkspace(workspace.id),
    )
    expect(list.map((s) => s.id)).toEqual([server.id])

    expect(
      expectOk(await SteelMcpServerRepository.findById(server.id, workspace.id))
        .encryptedAuthValue,
    ).toBe('cipher')
    expectErr(
      await SteelMcpServerRepository.findById(server.id, other.workspace.id),
      'STEEL_MCP_SERVER_NOT_FOUND',
    )

    const updated = expectOk(
      await SteelMcpServerRepository.update(server.id, {
        allowedTools: ['list_issues'],
        enabled: false,
      }),
    )
    expect(updated.allowedTools).toEqual(['list_issues'])
    expect(updated.enabled).toBe(false)

    expectOk(await SteelMcpServerRepository.delete(server.id))
    expect(
      expectOk(await SteelMcpServerRepository.listByWorkspace(workspace.id)),
    ).toEqual([])
  })

  it('should enforce the unique slug per workspace', async () => {
    const { workspace } = await context()
    await createSteelMcpServer(workspace.id)
    const duplicate = await SteelMcpServerRepository.create({
      workspaceId: workspace.id,
      name: 'Outro',
      slug: 'github',
      url: 'https://x.example.com',
      allowedTools: [],
    })
    expectErr(duplicate, 'DATABASE_ERROR')
  })

  it('should surface database errors as results', async () => {
    expectErr(
      await SteelMcpServerRepository.update('missing', { enabled: false }),
      'DATABASE_ERROR',
    )
    expectErr(
      await SteelMcpServerRepository.delete('missing'),
      'DATABASE_ERROR',
    )
  })
})
