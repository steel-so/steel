import { describe, expect, it, vi } from 'vitest'
import { seedSteelAgent } from '@/src/__tests__/factories/steel-agent.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  SteelAgentAssignmentRepository,
  SteelAgentRepository,
} from '../steel-agent.repository'

describe('SteelAgentAssignmentRepository', () => {
  it('should assign, replace and remove the agent of a record', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const first = await seedSteelAgent({ workspaceId: workspace.id })
    const second = await seedSteelAgent({ workspaceId: workspace.id })
    const key = {
      workspaceId: workspace.id,
      entityType: 'SD_TICKET' as const,
      entityId: 'ticket1',
    }

    expect(
      expectOk(
        await SteelAgentAssignmentRepository.find(
          key.entityType,
          key.entityId,
          key.workspaceId,
        ),
      ),
    ).toBeNull()

    const created = expectOk(
      await SteelAgentAssignmentRepository.upsert({
        ...key,
        agentId: first.id,
        assignedById: user.id,
      }),
    )
    expect(created.agentId).toBe(first.id)

    // Re-assigning keeps one row per record.
    const replaced = expectOk(
      await SteelAgentAssignmentRepository.upsert({
        ...key,
        agentId: second.id,
        assignedById: null,
      }),
    )
    expect(replaced.id).toBe(created.id)
    expect(replaced.agentId).toBe(second.id)
    expect(replaced.assignedById).toBeNull()

    // Another workspace never sees the row.
    expect(
      expectOk(
        await SteelAgentAssignmentRepository.find(
          key.entityType,
          key.entityId,
          'other-workspace',
        ),
      ),
    ).toBeNull()

    expect(
      expectOk(
        await SteelAgentAssignmentRepository.remove(
          key.entityType,
          key.entityId,
          key.workspaceId,
        ),
      ),
    ).toBe(1)
    expect(
      expectOk(
        await SteelAgentAssignmentRepository.remove(
          key.entityType,
          key.entityId,
          key.workspaceId,
        ),
      ),
    ).toBe(0)
  })

  it('should drop the assignment when the agent is deleted', async () => {
    const workspace = await seedWorkspace()
    const agent = await seedSteelAgent({ workspaceId: workspace.id })
    await SteelAgentAssignmentRepository.upsert({
      workspaceId: workspace.id,
      agentId: agent.id,
      entityType: 'CRM_LEAD',
      entityId: 'lead1',
      assignedById: null,
    })
    await prisma.steelAgent.delete({ where: { id: agent.id } })
    expect(await prisma.steelAgentAssignment.count()).toBe(0)
  })

  it('should list only enabled agents of the workspace among the ids', async () => {
    const [workspace, other] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
    ])
    const on = await seedSteelAgent({ workspaceId: workspace.id })
    const off = await seedSteelAgent({
      workspaceId: workspace.id,
      enabled: false,
    })
    const foreign = await seedSteelAgent({ workspaceId: other.id })

    const found = expectOk(
      await SteelAgentRepository.listEnabledByIds(workspace.id, [
        on.id,
        off.id,
        foreign.id,
      ]),
    )
    expect(found.map((a) => a.id)).toEqual([on.id])
    expect(
      expectOk(await SteelAgentRepository.listEnabledByIds(workspace.id, [])),
    ).toEqual([])
  })

  it('should return database errors as Result', async () => {
    vi.spyOn(prisma.steelAgentAssignment, 'findFirst').mockRejectedValueOnce(
      new Error('down'),
    )
    vi.spyOn(prisma.steelAgentAssignment, 'upsert').mockRejectedValueOnce(
      new Error('down'),
    )
    vi.spyOn(prisma.steelAgentAssignment, 'deleteMany').mockRejectedValueOnce(
      new Error('down'),
    )
    vi.spyOn(prisma.steelAgent, 'findMany').mockRejectedValueOnce(
      new Error('down'),
    )
    expectErr(
      await SteelAgentAssignmentRepository.find('SD_TICKET', 't', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await SteelAgentAssignmentRepository.upsert({
        workspaceId: 'w',
        agentId: 'a',
        entityType: 'SD_TICKET',
        entityId: 't',
        assignedById: null,
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await SteelAgentAssignmentRepository.remove('SD_TICKET', 't', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await SteelAgentRepository.listEnabledByIds('w', ['a']),
      'DATABASE_ERROR',
    )
  })
})
