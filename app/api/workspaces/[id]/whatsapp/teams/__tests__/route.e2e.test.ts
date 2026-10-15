import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

let counter = 0
function suffix() {
  counter += 1
  return `${Date.now()}${counter}`
}

async function seedConversation(
  workspaceId: string,
  createdById: string,
  data: { assignedUserId?: string | null; teamId?: string | null } = {},
) {
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'ZAPI',
      label: 'Principal',
      phoneNumber: `5511${suffix()}`,
      zapiInstanceId: `inst-${suffix()}`,
      encryptedZapiToken: 'enc:token',
      createdById,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId, waId: `5511${suffix()}`, name: 'Maria' },
  })
  return prisma.whatsAppConversation.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      contactId: contact.id,
      status: data.assignedUserId ? 'IN_PROGRESS' : 'NEW',
      assignedUserId: data.assignedUserId ?? null,
      teamId: data.teamId ?? null,
    },
  })
}

describe('/api/workspaces/[id]/whatsapp/teams', () => {
  it('lets the owner create, read, update and delete a team', async () => {
    const { user, workspace } = await authenticatedOwner()
    const agent = await addMember(workspace.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/teams`

    const created = await postJson(
      base,
      {
        name: 'Vendas',
        members: [
          { userId: agent.id, role: 'AGENT' },
          { userId: user.id, role: 'LEADER' },
        ],
      },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const team = (await created.json()).data
    expect(team.members.map((m: { role: string }) => m.role)).toEqual([
      'LEADER',
      'AGENT',
    ])

    const duplicate = await postJson(base, { name: 'Vendas' }, user.cookie)
    expect(duplicate.status).toBe(409)
    expect((await duplicate.json()).error.code).toBe('WHATSAPP_TEAM_CONFLICT')

    const list = await getJson(base, user.cookie)
    expect((await list.json()).data).toHaveLength(1)

    const updated = await patchJson(
      `${base}/${team.id}`,
      { name: 'Vendas B2B', members: [{ userId: agent.id, role: 'LEADER' }] },
      user.cookie,
    )
    expect(updated.status).toBe(200)
    const updatedBody = (await updated.json()).data
    expect(updatedBody.name).toBe('Vendas B2B')
    expect(updatedBody.members).toHaveLength(1)

    const one = await getJson(`${base}/${team.id}`, user.cookie)
    expect((await one.json()).data.name).toBe('Vendas B2B')

    const removed = await deleteJson(`${base}/${team.id}`, user.cookie)
    expect(removed.status).toBe(200)
    const missing = await getJson(`${base}/${team.id}`, user.cookie)
    expect(missing.status).toBe(404)
  })

  it('lets members read teams but not manage them', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/teams`

    expect((await getJson(base, member.cookie)).status).toBe(200)
    const denied = await postJson(base, { name: 'X' }, member.cookie)
    expect(denied.status).toBe(403)
  })

  it('validates the body and the members', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/teams`

    const invalid = await postJson(base, { name: '' }, user.cookie)
    expect(invalid.status).toBe(422)
    const stranger = await postJson(
      base,
      { name: 'X', members: [{ userId: 'not-a-member' }] },
      user.cookie,
    )
    expect(stranger.status).toBe(400)
  })

  it('reports the caller scope on /teams/me', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id)
    const team = await prisma.whatsAppTeam.create({
      data: {
        workspaceId: workspace.id,
        name: 'Suporte',
        members: { create: [{ userId: member.id, role: 'LEADER' }] },
      },
    })
    const path = `/api/workspaces/${workspace.id}/whatsapp/teams/me`

    expect((await (await getJson(path, user.cookie)).json()).data.mode).toBe(
      'ALL',
    )
    expect((await (await getJson(path, member.cookie)).json()).data).toEqual({
      mode: 'SCOPED',
      leadsTeamIds: [team.id],
      memberTeamIds: [team.id],
    })
  })
})

describe('Comunicação conversations · Equipes visibility', () => {
  it('scopes a member to their conversations and the queue', async () => {
    const { user, workspace } = await authenticatedOwner()
    const agent = await addMember(workspace.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/conversations`

    const owners = await seedConversation(workspace.id, user.id, {
      assignedUserId: user.id,
    })
    const queue = await seedConversation(workspace.id, user.id)

    const ownerList = (await (await getJson(base, user.cookie)).json()).data
    expect(ownerList).toHaveLength(2)

    const agentList = (await (await getJson(base, agent.cookie)).json()).data
    expect(agentList.map((c: { id: string }) => c.id)).toEqual([queue.id])

    expect(
      (await getJson(`${base}/${owners.id}/events`, agent.cookie)).status,
    ).toBe(404)
    expect(
      (await getJson(`${base}/${owners.id}/messages`, agent.cookie)).status,
    ).toBe(404)

    // The agent takes the queue item, but cannot hand it to someone else.
    const taken = await patchJson(
      `${base}/${queue.id}/assign`,
      { assignedUserId: agent.id },
      agent.cookie,
    )
    expect(taken.status).toBe(200)
    expect((await taken.json()).data.assignedUserId).toBe(agent.id)
    const passed = await patchJson(
      `${base}/${queue.id}/assign`,
      { assignedUserId: user.id },
      agent.cookie,
    )
    expect(passed.status).toBe(403)

    const events = (
      await (await getJson(`${base}/${queue.id}/events`, agent.cookie)).json()
    ).data
    expect(events.map((e: { kind: string }) => e.kind)).toEqual(['ASSIGNED'])
  })

  it('routes a conversation to a team queue only its members see', async () => {
    const { user, workspace } = await authenticatedOwner()
    const salesAgent = await addMember(workspace.id)
    const outsider = await addMember(workspace.id)
    const team = await prisma.whatsAppTeam.create({
      data: {
        workspaceId: workspace.id,
        name: 'Vendas',
        members: { create: [{ userId: salesAgent.id, role: 'AGENT' }] },
      },
    })
    const conversation = await seedConversation(workspace.id, user.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/conversations`

    const moved = await patchJson(
      `${base}/${conversation.id}/team`,
      { teamId: team.id },
      user.cookie,
    )
    expect(moved.status).toBe(200)
    expect((await moved.json()).data.team).toEqual({
      id: team.id,
      name: 'Vendas',
    })

    expect(
      (await getJson(`${base}/${conversation.id}/events`, salesAgent.cookie))
        .status,
    ).toBe(200)
    expect(
      (await getJson(`${base}/${conversation.id}/events`, outsider.cookie))
        .status,
    ).toBe(404)

    // Agents cannot move conversations between teams.
    const denied = await patchJson(
      `${base}/${conversation.id}/team`,
      { teamId: null },
      salesAgent.cookie,
    )
    expect(denied.status).toBe(403)

    const unknown = await patchJson(
      `${base}/${conversation.id}/team`,
      { teamId: 'missing-team' },
      user.cookie,
    )
    expect(unknown.status).toBe(404)
  })
})
