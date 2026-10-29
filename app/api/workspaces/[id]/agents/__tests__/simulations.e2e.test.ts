import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  deleteJson,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

const agentsBase = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/agents`
const simsBase = (workspaceId: string, agentId: string) =>
  `${agentsBase(workspaceId)}/${agentId}/simulations`

const scenario = {
  label: 'Cliente irritado',
  persona: 'Cliente sem paciência.',
  scenario: 'Internet fora desde ontem.',
  channel: 'WHATSAPP',
  openingMessage: 'Minha internet não volta!',
  criteria: ['Reconhece o problema', 'Informa o próximo passo'],
  maxTurns: 3,
}

async function createAgent(
  workspaceId: string,
  ownerId: string,
  cookie: string,
) {
  const res = await postJson(
    agentsBase(workspaceId),
    {
      name: 'Atendimento',
      instructions: 'Atenda o cliente com empatia.',
      triggerType: 'MANUAL',
      ownerId,
      tools: [{ toolName: 'ws_overview' }],
    },
    cookie,
  )
  expect(res.status).toBe(201)
  return (await res.json()).data as { id: string }
}

describe('Agent simulations — authentication', () => {
  it.each([
    ['GET', ''],
    ['POST', ''],
    ['POST', '/generate'],
    ['GET', '/s1'],
    ['DELETE', '/s1'],
    ['POST', '/s1/rerun'],
  ])('should return 401 for %s %s without a session', async (method, path) => {
    const res = await fetch(`${BASE_URL}${simsBase('ws', 'a1')}${path}`, {
      method,
      headers: defaultHeaders,
      ...(method === 'POST' && { body: '{}' }),
    })
    expect(res.status).toBe(401)
  })

  it('should return 403 for a non-member', async () => {
    const { user, workspace } = await authenticatedOwner()
    const agent = await createAgent(workspace.id, user.id, user.cookie)
    const stranger = await createAuthenticatedUser()
    const res = await getJson(simsBase(workspace.id, agent.id), stranger.cookie)
    expect(res.status).toBe(403)
  })
})

describe('Agent simulations', () => {
  it('should queue, list, read, rerun and delete a simulation', async () => {
    const { user, workspace } = await authenticatedOwner()
    const agent = await createAgent(workspace.id, user.id, user.cookie)
    const url = simsBase(workspace.id, agent.id)

    const created = await postJson(
      url,
      { name: 'Antes de ativar', passScore: 75, scenarios: [scenario] },
      user.cookie,
    )
    expect(created.status).toBe(202)
    const simulation = (await created.json()).data
    expect(simulation).toMatchObject({
      agentId: agent.id,
      name: 'Antes de ativar',
      status: 'QUEUED',
      passScore: 75,
      totalCases: 1,
    })

    // One at a time per agent.
    const second = await postJson(url, { scenarios: [scenario] }, user.cookie)
    expect(second.status).toBe(409)
    expect((await second.json()).error.code).toBe(
      'STEEL_AGENT_SIMULATION_IN_PROGRESS',
    )

    const list = await getJson(`${url}?limit=5`, user.cookie)
    expect(list.status).toBe(200)
    expect(((await list.json()).data as { id: string }[])[0].id).toBe(
      simulation.id,
    )

    const detail = await getJson(`${url}/${simulation.id}`, user.cookie)
    expect(detail.status).toBe(200)
    const detailBody = (await detail.json()).data
    expect(detailBody.agentName).toBe('Atendimento')
    expect(detailBody.cases).toHaveLength(1)
    expect(detailBody.cases[0]).toMatchObject({
      label: 'Cliente irritado',
      channel: 'WHATSAPP',
      criteria: scenario.criteria,
      transcript: [],
    })

    // Finish it, then repeat the same scenarios.
    await prisma.steelAgentSimulation.update({
      where: { id: simulation.id },
      data: { status: 'COMPLETED' },
    })
    const rerun = await postJson(
      `${url}/${simulation.id}/rerun`,
      {},
      user.cookie,
    )
    expect(rerun.status).toBe(202)
    const rerunBody = (await rerun.json()).data
    expect(rerunBody.name).toBe('Antes de ativar (repetição)')
    expect(rerunBody.passScore).toBe(75)

    await prisma.steelAgentSimulation.update({
      where: { id: rerunBody.id },
      data: { status: 'FAILED' },
    })
    const removed = await deleteJson(`${url}/${rerunBody.id}`, user.cookie)
    expect(removed.status).toBe(200)
    expect((await getJson(`${url}/${rerunBody.id}`, user.cookie)).status).toBe(
      404,
    )
  })

  it('should validate the body', async () => {
    const { user, workspace } = await authenticatedOwner()
    const agent = await createAgent(workspace.id, user.id, user.cookie)
    const url = simsBase(workspace.id, agent.id)

    for (const body of [
      {},
      { scenarios: [] },
      { scenarios: [{ ...scenario, criteria: [] }] },
      { scenarios: [{ ...scenario, channel: 'SMS' }] },
      { passScore: 0, scenarios: [scenario] },
    ]) {
      const res = await postJson(url, body, user.cookie)
      expect(res.status).toBe(422)
    }
    const generate = await postJson(
      `${url}/generate`,
      { count: 99 },
      user.cookie,
    )
    expect(generate.status).toBe(422)
    expect((await getJson(`${url}?limit=0`, user.cookie)).status).toBe(422)
  })

  it('should let members read but not simulate or delete', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id)
    const agent = await createAgent(workspace.id, user.id, user.cookie)
    const url = simsBase(workspace.id, agent.id)
    const created = await postJson(url, { scenarios: [scenario] }, user.cookie)
    const simulation = (await created.json()).data

    expect((await getJson(url, member.cookie)).status).toBe(200)
    expect(
      (await getJson(`${url}/${simulation.id}`, member.cookie)).status,
    ).toBe(200)
    expect(
      (await postJson(url, { scenarios: [scenario] }, member.cookie)).status,
    ).toBe(403)
    expect((await postJson(`${url}/generate`, {}, member.cookie)).status).toBe(
      403,
    )
    expect(
      (await postJson(`${url}/${simulation.id}/rerun`, {}, member.cookie))
        .status,
    ).toBe(403)
    expect(
      (await deleteJson(`${url}/${simulation.id}`, member.cookie)).status,
    ).toBe(403)
  })

  it('should 404 an agent or simulation of another workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    const other = await authenticatedOwner()
    const agent = await createAgent(
      other.workspace.id,
      other.user.id,
      other.user.cookie,
    )
    const created = await postJson(
      simsBase(other.workspace.id, agent.id),
      { scenarios: [scenario] },
      other.user.cookie,
    )
    const simulation = (await created.json()).data

    // Same ids through this workspace never resolve.
    const own = await createAgent(workspace.id, user.id, user.cookie)
    expect([403, 404]).toContain(
      (
        await getJson(
          `${simsBase(workspace.id, agent.id)}/${simulation.id}`,
          user.cookie,
        )
      ).status,
    )
    expect(
      (
        await getJson(
          `${simsBase(workspace.id, own.id)}/${simulation.id}`,
          user.cookie,
        )
      ).status,
    ).toBe(404)
  })
})
