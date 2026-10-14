import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'
import { whatsappUsagePeriod } from '@/src/lib/whatsapp/usage-period'

let counter = 0
function suffix() {
  counter += 1
  return `${Date.now()}${counter}`
}

async function seedConnectionAndContact(workspaceId: string, userId: string) {
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'ZAPI',
      label: 'Principal',
      phoneNumber: `5511${suffix()}`,
      zapiInstanceId: `inst-${suffix()}`,
      encryptedZapiToken: 'enc:token',
      createdById: userId,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId, waId: `5511${suffix()}`, name: 'Maria' },
  })
  return { connection, contact }
}

async function seedUsage(
  workspaceId: string,
  conversations: number,
  outboundMessages: number,
) {
  await prisma.whatsAppUsageMonthly.create({
    data: {
      workspaceId,
      period: whatsappUsagePeriod(),
      conversations,
      outboundMessages,
    },
  })
}

describe('/api/workspaces/[id]/whatsapp/usage', () => {
  it('should show zero usage and no limits to a plain member', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')

    const res = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/usage`,
      member.cookie,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({
      workspaceId: workspace.id,
      period: whatsappUsagePeriod(),
      canManage: false,
      conversations: { used: 0, limit: null, percent: null, reached: false },
      messages: { used: 0, limit: null, percent: null, reached: false },
    })
  })

  it('should let the owner set the limits and forbid a plain member', async () => {
    const { user, workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const url = `/api/workspaces/${workspace.id}/whatsapp/usage`

    const forbidden = await patchJson(
      url,
      { monthlyMessageLimit: 10 },
      member.cookie,
    )
    expect(forbidden.status).toBe(403)

    const updated = await patchJson(
      url,
      { monthlyConversationLimit: 300, monthlyMessageLimit: 5000 },
      user.cookie,
    )
    expect(updated.status).toBe(200)
    const body = (await updated.json()).data
    expect(body.canManage).toBe(true)
    expect(body.conversations.limit).toBe(300)
    expect(body.messages.limit).toBe(5000)

    const cleared = await patchJson(
      url,
      { monthlyMessageLimit: null },
      user.cookie,
    )
    const clearedBody = (await cleared.json()).data
    expect(clearedBody.messages.limit).toBeNull()
    expect(clearedBody.conversations.limit).toBe(300)
  })

  it('should reject an invalid limit', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await patchJson(
      `/api/workspaces/${workspace.id}/whatsapp/usage`,
      { monthlyMessageLimit: 0 },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should refuse to start a conversation once the monthly limit is reached', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { connection, contact } = await seedConnectionAndContact(
      workspace.id,
      user.id,
    )
    await patchJson(
      `/api/workspaces/${workspace.id}/whatsapp/usage`,
      { monthlyConversationLimit: 2 },
      user.cookie,
    )
    await seedUsage(workspace.id, 2, 0)

    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/conversations`,
      { contactId: contact.id, connectionId: connection.id },
      user.cookie,
    )
    expect(res.status).toBe(402)
    expect((await res.json()).error.code).toBe(
      'WHATSAPP_CONVERSATION_LIMIT_REACHED',
    )
  })

  it('should count a conversation the agent starts', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { connection, contact } = await seedConnectionAndContact(
      workspace.id,
      user.id,
    )

    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/conversations`,
      { contactId: contact.id, connectionId: connection.id },
      user.cookie,
    )
    expect(res.status).toBe(201)

    const usage = await getJson(
      `/api/workspaces/${workspace.id}/whatsapp/usage`,
      user.cookie,
    )
    expect((await usage.json()).data.conversations.used).toBe(1)
  })
})
