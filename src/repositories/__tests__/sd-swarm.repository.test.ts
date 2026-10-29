import { describe, expect, it, vi } from 'vitest'
import { seedSdSwarm } from '@/src/__tests__/factories/nov-s6-swarming.factory'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import { seedSdPhase } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SdSwarmRepository } from '../sd-swarm.repository'

async function setup() {
  const [workspace, starter, a, b] = await Promise.all([
    seedWorkspace(),
    seedUser(),
    seedUser(),
    seedUser(),
  ])
  const phase = await seedSdPhase(workspace.id)
  const ticket = await seedSdTicket(workspace.id, phase.id)
  return { workspace, starter, a, b, ticket }
}

describe('SdSwarmRepository', () => {
  it('creates with members and finds it by id and as the open one', async () => {
    const { workspace, starter, a, ticket } = await setup()
    const created = expectOk(
      await SdSwarmRepository.create({
        workspaceId: workspace.id,
        ticketId: ticket.id,
        reason: 'Rede',
        startedById: starter.id,
        memberIds: [a.id],
      }),
    )
    expect(created.members).toHaveLength(1)
    expect(created.members[0].status).toBe('INVITED')
    expect(created.startedBy?.id).toBe(starter.id)

    const byId = expectOk(
      await SdSwarmRepository.findById(created.id, ticket.id),
    )
    expect(byId.reason).toBe('Rede')
    expectErr(
      await SdSwarmRepository.findById(created.id, 'other-ticket'),
      'SD_SWARM_NOT_FOUND',
    )
    expect(
      expectOk(await SdSwarmRepository.findOpenByTicket(ticket.id))?.id,
    ).toBe(created.id)
    expect(
      expectOk(await SdSwarmRepository.findOpenByTicket('nope')),
    ).toBeNull()
  })

  it('lists newest first and checks membership', async () => {
    const { workspace, starter, a, b, ticket } = await setup()
    const older = await seedSdSwarm(
      workspace.id,
      ticket.id,
      starter.id,
      [a.id],
      'CLOSED',
    )
    await prisma.sdSwarm.update({
      where: { id: older.id },
      data: { startedAt: new Date('2026-01-01T00:00:00Z') },
    })
    const newer = await seedSdSwarm(workspace.id, ticket.id, starter.id, [a.id])
    const list = expectOk(await SdSwarmRepository.listByTicket(ticket.id))
    expect(list.map((s) => s.id)).toEqual([newer.id, older.id])
    expect(
      expectOk(await SdSwarmRepository.isMemberOfTicket(ticket.id, a.id)),
    ).toBe(true)
    expect(
      expectOk(await SdSwarmRepository.isMemberOfTicket(ticket.id, b.id)),
    ).toBe(false)
  })

  it('invites new users, re-invites declined and skips the others', async () => {
    const { workspace, starter, a, b, ticket } = await setup()
    const swarm = await seedSdSwarm(workspace.id, ticket.id, starter.id, [a.id])
    expectOk(await SdSwarmRepository.respond(swarm.id, a.id, 'DECLINED'))

    const invited = expectOk(
      await SdSwarmRepository.invite(swarm.id, [a.id, b.id], starter.id),
    )
    expect(invited.sort()).toEqual([a.id, b.id].sort())
    const rows = await prisma.sdSwarmMember.findMany({
      where: { swarmId: swarm.id },
    })
    expect(rows.every((r) => r.status === 'INVITED')).toBe(true)
    expect(rows.find((r) => r.userId === a.id)?.respondedAt).toBeNull()

    expectOk(await SdSwarmRepository.respond(swarm.id, b.id, 'JOINED'))
    expect(
      expectOk(await SdSwarmRepository.invite(swarm.id, [b.id], starter.id)),
    ).toEqual([])
    expect(
      (
        await prisma.sdSwarmMember.findUniqueOrThrow({
          where: { swarmId_userId: { swarmId: swarm.id, userId: b.id } },
        })
      ).status,
    ).toBe('JOINED')
  })

  it('stores the Slack channel and closes', async () => {
    const { workspace, starter, a, ticket } = await setup()
    const swarm = await seedSdSwarm(workspace.id, ticket.id, starter.id, [a.id])
    expectOk(
      await SdSwarmRepository.setSlack(swarm.id, {
        slackChannelId: 'C1',
        slackChannelName: 'swarm-inc-1',
        slackError: null,
      }),
    )
    const when = new Date('2026-10-29T13:00:00Z')
    expectOk(
      await SdSwarmRepository.close(swarm.id, {
        closedById: starter.id,
        outcome: 'Trocado o switch',
        slackArchivedAt: when,
      }),
    )
    const row = await prisma.sdSwarm.findUniqueOrThrow({
      where: { id: swarm.id },
    })
    expect(row).toMatchObject({
      status: 'CLOSED',
      slackChannelId: 'C1',
      outcome: 'Trocado o switch',
      closedById: starter.id,
    })
    expect(row.slackArchivedAt).toEqual(when)
    expect(row.closedAt).not.toBeNull()
  })

  it('maps failures to DATABASE_ERROR', async () => {
    const spies = [
      vi.spyOn(prisma.sdSwarm, 'create'),
      vi.spyOn(prisma.sdSwarm, 'findFirst'),
      vi.spyOn(prisma.sdSwarm, 'findMany'),
      vi.spyOn(prisma.sdSwarm, 'update'),
      vi.spyOn(prisma.sdSwarmMember, 'count'),
      vi.spyOn(prisma.sdSwarmMember, 'update'),
      vi.spyOn(prisma, '$transaction'),
    ]
    for (const spy of spies) spy.mockRejectedValue(new Error('boom'))
    const create = {
      workspaceId: 'w',
      ticketId: 't',
      reason: 'r',
      startedById: 'u',
      memberIds: ['m'],
    }
    expectErr(await SdSwarmRepository.create(create), 'DATABASE_ERROR')
    expectErr(await SdSwarmRepository.findById('s', 't'), 'DATABASE_ERROR')
    expectErr(await SdSwarmRepository.findOpenByTicket('t'), 'DATABASE_ERROR')
    expectErr(await SdSwarmRepository.listByTicket('t'), 'DATABASE_ERROR')
    expectErr(
      await SdSwarmRepository.isMemberOfTicket('t', 'u'),
      'DATABASE_ERROR',
    )
    expectErr(await SdSwarmRepository.invite('s', ['u'], 'a'), 'DATABASE_ERROR')
    expectErr(
      await SdSwarmRepository.respond('s', 'u', 'JOINED'),
      'DATABASE_ERROR',
    )
    expectErr(
      await SdSwarmRepository.setSlack('s', {
        slackChannelId: null,
        slackChannelName: null,
        slackError: 'x',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await SdSwarmRepository.close('s', {
        closedById: 'u',
        outcome: null,
        slackArchivedAt: null,
      }),
      'DATABASE_ERROR',
    )
    for (const spy of spies) spy.mockRestore()
  })
})
