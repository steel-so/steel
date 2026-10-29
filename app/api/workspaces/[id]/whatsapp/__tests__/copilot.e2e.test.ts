import { describe, expect, it } from 'vitest'
import { authenticatedOwner, postJson } from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

let counter = 0
function suffix() {
  counter += 1
  return `${Date.now()}${counter}`
}

async function seedEmptyConversation(workspaceId: string, userId: string) {
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
  return prisma.whatsAppConversation.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      contactId: contact.id,
      status: 'NEW',
    },
  })
}

describe('WhatsApp copilot', () => {
  it('should reject unauthenticated calls', async () => {
    const response = await postJson(
      '/api/workspaces/ws/whatsapp/conversations/c1/copilot/summary',
      {},
    )
    expect(response.status).toBe(401)
  })

  it('should answer 404 for a conversation that does not exist', async () => {
    const { user, workspace } = await authenticatedOwner()
    const response = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/conversations/missing/copilot/summary`,
      {},
      user.cookie,
    )
    expect(response.status).toBe(404)
  })

  it('should validate the tone payload', async () => {
    const { user, workspace } = await authenticatedOwner()
    const conversation = await seedEmptyConversation(workspace.id, user.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/conversations/${conversation.id}/copilot`

    const emptyText = await postJson(
      `${base}/tone`,
      { text: '  ', tone: 'FORMAL' },
      user.cookie,
    )
    expect(emptyText.status).toBe(422)

    const badTone = await postJson(
      `${base}/tone`,
      { text: 'oi', tone: 'ANGRY' },
      user.cookie,
    )
    expect(badTone.status).toBe(422)
  })

  it('should refuse to summarize or suggest on an empty conversation', async () => {
    const { user, workspace } = await authenticatedOwner()
    const conversation = await seedEmptyConversation(workspace.id, user.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/conversations/${conversation.id}/copilot`

    const summary = await postJson(`${base}/summary`, {}, user.cookie)
    expect(summary.status).toBe(422)
    expect((await summary.json()).error.code).toBe(
      'WHATSAPP_COPILOT_NO_CONTEXT',
    )

    const suggest = await postJson(`${base}/suggest`, {}, user.cookie)
    expect(suggest.status).toBe(422)
  })
})
