import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

const leadUrl = (workspaceId: string, leadId: string) =>
  `/api/workspaces/${workspaceId}/crm/leads/${leadId}/agent`

async function seed() {
  const { user, workspace } = await authenticatedOwner()
  const agent = await prisma.steelAgent.create({
    data: {
      workspaceId: workspace.id,
      name: 'Qualificação',
      instructions: 'Qualifique o lead.',
      triggerType: 'MANUAL',
      ownerId: user.id,
    },
  })
  const lead = await prisma.crmLead.create({
    data: { workspaceId: workspace.id, name: 'Acme', createdById: user.id },
  })
  return { user, workspace, agent, lead }
}

describe('Steel Agent assignment — leads', () => {
  it('should require authentication', async () => {
    const { workspace, lead } = await seed()
    const res = await getJson(leadUrl(workspace.id, lead.id))
    expect(res.status).toBe(401)
  })

  it('should assign, read back and remove the agent of a lead', async () => {
    const { user, workspace, agent, lead } = await seed()

    const empty = await getJson(leadUrl(workspace.id, lead.id), user.cookie)
    expect(empty.status).toBe(200)
    expect((await empty.json()).data.agent).toBeNull()

    const put = await putJson(
      leadUrl(workspace.id, lead.id),
      { agentId: agent.id },
      user.cookie,
    )
    expect(put.status).toBe(200)
    expect((await put.json()).data.agent).toMatchObject({
      id: agent.id,
      name: 'Qualificação',
    })

    const read = await getJson(leadUrl(workspace.id, lead.id), user.cookie)
    expect((await read.json()).data.agent.id).toBe(agent.id)

    const removed = await putJson(
      leadUrl(workspace.id, lead.id),
      { agentId: null },
      user.cookie,
    )
    expect(removed.status).toBe(200)
    expect((await removed.json()).data.agent).toBeNull()
  })

  it('should validate the body and refuse paused or foreign agents', async () => {
    const { user, workspace, agent, lead } = await seed()
    const url = leadUrl(workspace.id, lead.id)

    expect((await putJson(url, {}, user.cookie)).status).toBe(422)
    expect(
      (await putJson(url, { agentId: 'does-not-exist' }, user.cookie)).status,
    ).toBe(404)

    await prisma.steelAgent.update({
      where: { id: agent.id },
      data: { enabled: false },
    })
    expect(
      (await putJson(url, { agentId: agent.id }, user.cookie)).status,
    ).toBe(409)
  })

  it('should keep viewers read-only', async () => {
    const { workspace, agent, lead } = await seed()
    const viewer = await addMember(workspace.id, 'VIEWER')
    const url = leadUrl(workspace.id, lead.id)

    expect((await getJson(url, viewer.cookie)).status).toBe(200)
    expect(
      (await putJson(url, { agentId: agent.id }, viewer.cookie)).status,
    ).toBe(403)
  })

  it('should not reach a lead of another workspace', async () => {
    const { workspace } = await seed()
    const other = await seed()
    const res = await getJson(
      leadUrl(workspace.id, other.lead.id),
      other.user.cookie,
    )
    expect(res.status).toBe(403)
  })
})
