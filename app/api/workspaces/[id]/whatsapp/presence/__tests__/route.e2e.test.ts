import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  patchJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

describe('/api/workspaces/[id]/whatsapp/presence', () => {
  it('starts available and lets the agent turn away and back', async () => {
    const { workspace } = await authenticatedOwner()
    const agent = await addMember(workspace.id)
    const path = `/api/workspaces/${workspace.id}/whatsapp/presence/me`

    const initial = (await (await getJson(path, agent.cookie)).json()).data
    expect(initial).toMatchObject({
      userId: agent.id,
      status: 'AVAILABLE',
      updatedAt: null,
    })

    const away = await putJson(path, { status: 'AWAY' }, agent.cookie)
    expect(away.status).toBe(200)
    expect((await away.json()).data.status).toBe('AWAY')
    expect((await (await getJson(path, agent.cookie)).json()).data.status).toBe(
      'AWAY',
    )

    const back = await putJson(path, { status: 'AVAILABLE' }, agent.cookie)
    expect((await back.json()).data.status).toBe('AVAILABLE')
    expect(
      await prisma.whatsAppAgentPresence.count({
        where: { workspaceId: workspace.id, userId: agent.id },
      }),
    ).toBe(1)
  })

  it('validates the status', async () => {
    const { user, workspace } = await authenticatedOwner()
    const path = `/api/workspaces/${workspace.id}/whatsapp/presence/me`

    expect((await putJson(path, { status: 'BUSY' }, user.cookie)).status).toBe(
      422,
    )
    expect((await putJson(path, {}, user.cookie)).status).toBe(422)
  })

  it('refuses a viewer to change the status and a stranger to read it', async () => {
    const { workspace } = await authenticatedOwner()
    const viewer = await addMember(workspace.id, 'VIEWER')
    const stranger = await addMember((await authenticatedOwner()).workspace.id)
    const path = `/api/workspaces/${workspace.id}/whatsapp/presence/me`

    expect(
      (await putJson(path, { status: 'AWAY' }, viewer.cookie)).status,
    ).toBe(403)
    expect((await getJson(path, stranger.cookie)).status).toBe(403)
    expect((await getJson(path)).status).toBe(401)
  })

  it('shows team presence to admins and leaders only', async () => {
    const { user, workspace } = await authenticatedOwner()
    const leader = await addMember(workspace.id)
    const agent = await addMember(workspace.id)
    const outsider = await addMember(workspace.id)
    await prisma.whatsAppTeam.create({
      data: {
        workspaceId: workspace.id,
        name: 'Suporte',
        members: {
          create: [
            { userId: leader.id, role: 'LEADER' },
            { userId: agent.id, role: 'AGENT' },
          ],
        },
      },
    })
    await putJson(
      `/api/workspaces/${workspace.id}/whatsapp/presence/me`,
      { status: 'AWAY' },
      agent.cookie,
    )
    const list = `/api/workspaces/${workspace.id}/whatsapp/presence`

    for (const cookie of [user.cookie, leader.cookie]) {
      const body = (await (await getJson(list, cookie)).json()).data
      expect(
        Object.fromEntries(
          body.map((row: { userId: string; status: string }) => [
            row.userId,
            row.status,
          ]),
        ),
      ).toEqual({ [leader.id]: 'AVAILABLE', [agent.id]: 'AWAY' })
    }
    expect((await getJson(list, agent.cookie)).status).toBe(403)
    expect((await getJson(list, outsider.cookie)).status).toBe(403)
  })
})

describe('/api/workspaces/[id]/whatsapp/settings · queue and distribution', () => {
  it('saves and returns the distribution rules (admin only)', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id)
    const path = `/api/workspaces/${workspace.id}/whatsapp/settings`

    const defaults = (await (await getJson(path, user.cookie)).json()).data
    expect(defaults).toMatchObject({
      distributionMode: 'OFF',
      unassignedReminderMinutes: 10,
      distributionMaxOpenPerAgent: null,
    })

    const saved = await patchJson(
      path,
      {
        distributionMode: 'LEAST_LOADED',
        distributionMaxOpenPerAgent: 8,
        distributionOnlyAvailable: false,
        distributionRespectBusinessHours: false,
        unassignedReminderMinutes: 0,
        unassignedAlertNotifyEmail: true,
      },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    expect((await saved.json()).data).toMatchObject({
      distributionMode: 'LEAST_LOADED',
      distributionMaxOpenPerAgent: 8,
      distributionOnlyAvailable: false,
      distributionRespectBusinessHours: false,
      unassignedReminderMinutes: 0,
      unassignedAlertNotifyEmail: true,
    })

    expect(
      (await patchJson(path, { distributionMode: 'RANDOM' }, user.cookie))
        .status,
    ).toBe(422)
    expect(
      (await patchJson(path, { distributionMode: 'OFF' }, member.cookie))
        .status,
    ).toBe(403)
  })
})
