import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWhatsAppTeam } from '@/src/__tests__/factories/whatsapp-team.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppTeamRepository } from '../whatsapp-team.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

async function fixtures() {
  const [workspace, lia, ana] = await Promise.all([
    seedWorkspace(),
    seedUser({ name: 'Lia' }),
    seedUser({ name: 'Ana' }),
  ])
  return { workspace, lia, ana }
}

describe('WhatsAppTeamRepository', () => {
  it('creates a team with its members and reads it back', async () => {
    const { workspace, lia, ana } = await fixtures()

    const created = expectOk(
      await WhatsAppTeamRepository.create({
        workspaceId: workspace.id,
        name: 'Vendas',
        description: 'Inbound',
        members: [
          { userId: lia.id, role: 'LEADER' },
          { userId: ana.id, role: 'AGENT' },
        ],
      }),
    )
    expect(created.members).toHaveLength(2)
    expect(created.members[0].user.name).toBe('Lia')

    const found = expectOk(
      await WhatsAppTeamRepository.findById(created.id, workspace.id),
    )
    expect(found?.description).toBe('Inbound')
    expect(
      expectOk(await WhatsAppTeamRepository.findById(created.id, 'other-ws')),
    ).toBeNull()
  })

  it('defaults the description to null', async () => {
    const { workspace } = await fixtures()
    const created = expectOk(
      await WhatsAppTeamRepository.create({
        workspaceId: workspace.id,
        name: 'Suporte',
        members: [],
      }),
    )
    expect(created.description).toBeNull()
  })

  it('refuses a duplicate name in the same workspace', async () => {
    const { workspace } = await fixtures()
    await seedWhatsAppTeam({ workspaceId: workspace.id, name: 'Vendas' })

    expectErr(
      await WhatsAppTeamRepository.create({
        workspaceId: workspace.id,
        name: 'Vendas',
        members: [],
      }),
      'WHATSAPP_TEAM_CONFLICT',
    )
  })

  it('lists the workspace teams by name', async () => {
    const { workspace } = await fixtures()
    await seedWhatsAppTeam({ workspaceId: workspace.id, name: 'Suporte' })
    await seedWhatsAppTeam({ workspaceId: workspace.id, name: 'Comercial' })
    await seedWhatsAppTeam({ workspaceId: (await seedWorkspace()).id })

    const teams = expectOk(
      await WhatsAppTeamRepository.listByWorkspace(workspace.id),
    )
    expect(teams.map((t) => t.name)).toEqual(['Comercial', 'Suporte'])
  })

  it('builds the membership snapshot', async () => {
    const { workspace, lia, ana } = await fixtures()
    const team = await seedWhatsAppTeam({
      workspaceId: workspace.id,
      members: [
        { userId: lia.id, role: 'LEADER' },
        { userId: ana.id, role: 'AGENT' },
      ],
    })

    const snapshot = expectOk(
      await WhatsAppTeamRepository.listMembershipSnapshot(workspace.id),
    )
    expect(snapshot).toEqual([
      {
        id: team.id,
        members: expect.arrayContaining([
          { userId: lia.id, role: 'LEADER' },
          { userId: ana.id, role: 'AGENT' },
        ]),
      },
    ])
  })

  it('updates the fields and replaces the member list', async () => {
    const { workspace, lia, ana } = await fixtures()
    const team = await seedWhatsAppTeam({
      workspaceId: workspace.id,
      members: [{ userId: lia.id, role: 'LEADER' }],
    })

    const updated = expectOk(
      await WhatsAppTeamRepository.update(team.id, {
        name: 'Renomeada',
        description: 'Nova',
        members: [{ userId: ana.id, role: 'LEADER' }],
      }),
    )
    expect(updated.name).toBe('Renomeada')
    expect(updated.members.map((m) => [m.userId, m.role])).toEqual([
      [ana.id, 'LEADER'],
    ])

    const untouched = expectOk(
      await WhatsAppTeamRepository.update(team.id, { description: null }),
    )
    expect(untouched.description).toBeNull()
    expect(untouched.members).toHaveLength(1)
  })

  it('refuses renaming onto another team name', async () => {
    const { workspace } = await fixtures()
    await seedWhatsAppTeam({ workspaceId: workspace.id, name: 'A' })
    const b = await seedWhatsAppTeam({ workspaceId: workspace.id, name: 'B' })

    expectErr(
      await WhatsAppTeamRepository.update(b.id, { name: 'A' }),
      'WHATSAPP_TEAM_CONFLICT',
    )
  })

  it('deletes a team and keeps its conversations without a team', async () => {
    const { workspace, lia } = await fixtures()
    const team = await seedWhatsAppTeam({ workspaceId: workspace.id })
    const connection = await prisma.whatsAppConnection.create({
      data: {
        workspaceId: workspace.id,
        provider: 'ZAPI',
        label: 'Suporte',
        phoneNumber: '5511999990000',
        zapiInstanceId: `inst-team-${team.id}`,
        encryptedZapiToken: 'enc:token',
        createdById: lia.id,
      },
    })
    const contact = await prisma.whatsAppContact.create({
      data: { workspaceId: workspace.id, waId: '5511977776666' },
    })
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contact.id,
        teamId: team.id,
      },
    })

    expectOk(await WhatsAppTeamRepository.delete(team.id))

    const kept = await prisma.whatsAppConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    })
    expect(kept.teamId).toBeNull()
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const boom = new Error('db down')
    vi.spyOn(prisma.whatsAppTeam, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppTeam, 'findFirst').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppTeam, 'create').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppTeam, 'update').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppTeam, 'delete').mockRejectedValueOnce(boom)

    expectErr(
      await WhatsAppTeamRepository.listByWorkspace('ws'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppTeamRepository.listMembershipSnapshot('ws'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppTeamRepository.findById('t', 'ws'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppTeamRepository.create({
        workspaceId: 'ws',
        name: 'x',
        members: [],
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppTeamRepository.update('t', { name: 'x' }),
      'DATABASE_ERROR',
    )
    expectErr(await WhatsAppTeamRepository.delete('t'), 'DATABASE_ERROR')
  })
})
