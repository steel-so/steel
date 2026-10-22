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

async function seedOpenCycle(workspaceId: string, userId: string) {
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'ZAPI',
      label: 'Principal',
      phoneNumber: `5511${suffix()}`.slice(0, 13),
      zapiInstanceId: `instance-${suffix()}`,
      encryptedZapiToken: 'enc:token',
      createdById: userId,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: {
      workspaceId,
      waId: `5511987${suffix()}`.slice(0, 13),
      name: 'Maria',
    },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      contactId: contact.id,
      status: 'NEW',
    },
  })
  const startedAt = new Date(Date.now() - 60 * 60 * 1000)
  const cycle = await prisma.whatsAppSlaCycle.create({
    data: {
      workspaceId,
      conversationId: conversation.id,
      firstResponseMinutes: 15,
      startedAt,
      firstResponseDueAt: new Date(startedAt.getTime() + 15 * 60 * 1000),
      firstResponseWarnAt: new Date(startedAt.getTime() + 12 * 60 * 1000),
    },
  })
  return { conversation, cycle }
}

describe('SLA policies', () => {
  it('should create, list, update and remove the default policy', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/sla/policies`

    const created = await postJson(base, {}, user.cookie)
    expect(created.status).toBe(201)
    const policy = (await created.json()).data
    expect(policy).toMatchObject({
      teamId: null,
      enabled: false,
      firstResponseMinutes: 15,
      businessHoursOnly: true,
    })

    const duplicate = await postJson(base, {}, user.cookie)
    expect(duplicate.status).toBe(409)

    const updated = await patchJson(
      `${base}/${policy.id}`,
      { enabled: true, firstResponseMinutes: 5, resolutionMinutes: 60 },
      user.cookie,
    )
    expect(updated.status).toBe(200)
    expect((await updated.json()).data).toMatchObject({
      enabled: true,
      firstResponseMinutes: 5,
      resolutionMinutes: 60,
    })

    const invalid = await patchJson(
      `${base}/${policy.id}`,
      { firstResponseMinutes: 120 },
      user.cookie,
    )
    expect(invalid.status).toBe(422)

    const list = await getJson(base, user.cookie)
    expect((await list.json()).data).toHaveLength(1)

    const removed = await deleteJson(`${base}/${policy.id}`, user.cookie)
    expect(removed.status).toBe(200)
    const missing = await patchJson(
      `${base}/${policy.id}`,
      { enabled: false },
      user.cookie,
    )
    expect(missing.status).toBe(404)
  })

  it('should create a team override and refuse a team of another workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    const other = await authenticatedOwner()
    const team = await prisma.whatsAppTeam.create({
      data: { workspaceId: workspace.id, name: 'Vendas' },
    })
    const foreignTeam = await prisma.whatsAppTeam.create({
      data: { workspaceId: other.workspace.id, name: 'Outra' },
    })
    const base = `/api/workspaces/${workspace.id}/whatsapp/sla/policies`

    const ok = await postJson(base, { teamId: team.id }, user.cookie)
    expect(ok.status).toBe(201)
    expect((await ok.json()).data).toMatchObject({
      teamId: team.id,
      teamName: 'Vendas',
    })

    const foreign = await postJson(
      base,
      { teamId: foreignTeam.id },
      user.cookie,
    )
    expect(foreign.status).toBe(422)
  })

  it('should reject invalid bodies and unauthenticated or non-admin callers', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const base = `/api/workspaces/${workspace.id}/whatsapp/sla/policies`

    const invalid = await postJson(base, { warnAtPercent: 150 }, user.cookie)
    expect(invalid.status).toBe(422)

    const forbidden = await postJson(base, {}, member.cookie)
    expect(forbidden.status).toBe(403)

    const unauthenticated = await getJson(base)
    expect(unauthenticated.status).toBe(401)
  })
})

describe('SLA open cycles', () => {
  it('should list the open cycle with its state and filter by state', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { conversation } = await seedOpenCycle(workspace.id, user.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/sla/open`

    const all = await getJson(base, user.cookie)
    expect(all.status).toBe(200)
    const cycles = (await all.json()).data
    expect(cycles).toHaveLength(1)
    expect(cycles[0]).toMatchObject({
      conversationId: conversation.id,
      state: 'BREACHED',
    })

    const breached = await getJson(`${base}?state=BREACHED`, user.cookie)
    expect((await breached.json()).data).toHaveLength(1)

    const invalid = await getJson(`${base}?state=OK`, user.cookie)
    expect(invalid.status).toBe(422)
  })

  it('should not leak cycles across workspaces', async () => {
    const mine = await authenticatedOwner()
    const other = await authenticatedOwner()
    await seedOpenCycle(other.workspace.id, other.user.id)

    const res = await getJson(
      `/api/workspaces/${mine.workspace.id}/whatsapp/sla/open`,
      mine.user.cookie,
    )
    expect((await res.json()).data).toEqual([])

    const crossed = await getJson(
      `/api/workspaces/${other.workspace.id}/whatsapp/sla/open`,
      mine.user.cookie,
    )
    expect(crossed.status).toBe(403)
  })
})

describe('SLA report', () => {
  it('should summarize the period and export it as CSV', async () => {
    const { user, workspace } = await authenticatedOwner()
    await seedOpenCycle(workspace.id, user.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/sla/report`

    const res = await getJson(base, user.cookie)
    expect(res.status).toBe(200)
    const report = (await res.json()).data
    expect(report).toMatchObject({
      timeZone: 'America/Sao_Paulo',
      firstResponse: { evaluated: 1, withinTarget: 0, withinPercent: 0 },
    })

    const csv = await getJson(`${base}?format=csv`, user.cookie)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(await csv.text()).toContain('Primeira resposta,Total,1,0,0')
  })

  it('should refuse a bad period and a plain agent', async () => {
    const { user, workspace } = await authenticatedOwner()
    const agent = await addMember(workspace.id, 'MEMBER')
    const base = `/api/workspaces/${workspace.id}/whatsapp/sla/report`

    const reversed = await getJson(
      `${base}?from=2026-10-05&to=2026-10-01`,
      user.cookie,
    )
    expect(reversed.status).toBe(422)

    const malformed = await getJson(`${base}?from=ontem`, user.cookie)
    expect(malformed.status).toBe(422)

    const forbidden = await getJson(base, agent.cookie)
    expect(forbidden.status).toBe(403)
  })
})
