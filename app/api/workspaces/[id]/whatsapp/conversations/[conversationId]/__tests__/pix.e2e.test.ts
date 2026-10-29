import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  defaultHeaders,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

let counter = 0
function suffix() {
  counter += 1
  return `${Date.now()}${counter}`
}

async function seedConversation(workspaceId: string, userId: string) {
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
  return prisma.whatsAppConversation.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      contactId: contact.id,
      status: 'IN_PROGRESS',
      assignedUserId: userId,
    },
  })
}

function seedCharge(workspaceId: string, conversationId: string) {
  const providerChargeId = `tx${suffix()}`
  return prisma.whatsAppPixCharge.create({
    data: {
      workspaceId,
      conversationId,
      provider: 'mock',
      providerChargeId,
      amount: 150,
      description: 'Mensalidade',
      brCode: `000201${providerChargeId}`,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  })
}

describe('Pix in the conversation', () => {
  it('should keep Pix off until an admin turns it on', async () => {
    const { user, workspace } = await authenticatedOwner()
    const conversation = await seedConversation(workspace.id, user.id)
    const settingsUrl = `/api/workspaces/${workspace.id}/whatsapp/pix/settings`

    const initial = await getJson(settingsUrl, user.cookie)
    expect(initial.status).toBe(200)
    expect((await initial.json()).data).toMatchObject({
      enabled: false,
      defaultExpiresMinutes: 60,
      provider: 'mock',
      isTestProvider: true,
    })

    const refused = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/conversations/${conversation.id}/pix`,
      { amount: 150, description: 'Mensalidade' },
      user.cookie,
    )
    expect(refused.status).toBe(422)
    expect((await refused.json()).error.code).toBe('PIX_DISABLED')

    const saved = await patchJson(
      settingsUrl,
      { enabled: true, defaultExpiresMinutes: 30 },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    expect((await saved.json()).data).toMatchObject({
      enabled: true,
      defaultExpiresMinutes: 30,
    })
  })

  it('should validate the charge body', async () => {
    const { user, workspace } = await authenticatedOwner()
    const conversation = await seedConversation(workspace.id, user.id)
    const res = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/conversations/${conversation.id}/pix`,
      { amount: 0, description: '' },
      user.cookie,
    )
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
  })

  it('should only let admins change the switch', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const res = await patchJson(
      `/api/workspaces/${workspace.id}/whatsapp/pix/settings`,
      { enabled: true },
      member.cookie,
    )
    expect(res.status).toBe(403)
  })

  it('should list, simulate the payment of and refuse to cancel a charge', async () => {
    const { user, workspace } = await authenticatedOwner()
    const conversation = await seedConversation(workspace.id, user.id)
    const charge = await seedCharge(workspace.id, conversation.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/conversations/${conversation.id}`

    const list = await getJson(`${base}/pix`, user.cookie)
    expect(list.status).toBe(200)
    const listed = (await list.json()).data
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: charge.id, status: 'PENDING' })

    const paid = await postJson(
      `${base}/pix/${charge.id}/simulate-payment`,
      {},
      user.cookie,
    )
    expect(paid.status).toBe(200)
    expect((await paid.json()).data.status).toBe('PAID')

    // Idempotent: a second payment changes nothing.
    const again = await postJson(
      `${base}/pix/${charge.id}/simulate-payment`,
      {},
      user.cookie,
    )
    expect(again.status).toBe(200)

    const events = await getJson(`${base}/events`, user.cookie)
    const kinds = (await events.json()).data.map(
      (event: { kind: string }) => event.kind,
    )
    expect(kinds.filter((kind: string) => kind === 'PIX_PAID')).toHaveLength(1)

    const cancel = await deleteJson(`${base}/pix/${charge.id}`, user.cookie)
    expect(cancel.status).toBe(409)
    expect((await cancel.json()).error.code).toBe('PIX_CHARGE_NOT_PENDING')
  })

  it('should cancel a pending charge', async () => {
    const { user, workspace } = await authenticatedOwner()
    const conversation = await seedConversation(workspace.id, user.id)
    const charge = await seedCharge(workspace.id, conversation.id)

    const res = await deleteJson(
      `/api/workspaces/${workspace.id}/whatsapp/conversations/${conversation.id}/pix/${charge.id}`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data.status).toBe('CANCELED')
  })

  it('should require a session', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/ws/whatsapp/conversations/c/pix`,
      { headers: defaultHeaders },
    )
    expect(res.status).toBe(401)
  })
})

describe('POST /api/whatsapp/webhook/pix/[provider]', () => {
  it('should refuse an unsigned payment notice', async () => {
    const res = await fetch(`${BASE_URL}/api/whatsapp/webhook/pix/mock`, {
      method: 'POST',
      headers: { ...defaultHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ providerChargeId: 'x', paidAmount: 1 }),
    })
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('PIX_WEBHOOK_INVALID')
  })

  it('should answer 404 for an unknown provider', async () => {
    const res = await fetch(`${BASE_URL}/api/whatsapp/webhook/pix/acme`, {
      method: 'POST',
      headers: { ...defaultHeaders, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(404)
  })
})
