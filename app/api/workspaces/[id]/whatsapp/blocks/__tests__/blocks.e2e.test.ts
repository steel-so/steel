import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

let counter = 0
function suffix() {
  counter += 1
  return `${Date.now()}${counter}`.slice(-9)
}

/**
 * No provider credentials on purpose: the block never reaches Meta/Z-API
 * from the tests (FAILED, internal block only) — no network call.
 */
async function seedConversation(
  workspaceId: string,
  userId: string,
  assignedUserId: string | null = userId,
) {
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'META',
      label: 'Oficial',
      phoneNumber: `5511${suffix()}`,
      metaPhoneNumberId: `pn-${suffix()}`,
      createdById: userId,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId, waId: `5511${suffix()}`, name: 'Maria' },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      contactId: contact.id,
      status: 'IN_PROGRESS',
      assignedUserId,
    },
  })
  return { connection, contact, conversation }
}

describe('/api/workspaces/[id]/whatsapp/blocks', () => {
  it('should block from a conversation, show it everywhere and unblock it', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { conversation, contact, connection } = await seedConversation(
      workspace.id,
      user.id,
    )
    const base = `/api/workspaces/${workspace.id}/whatsapp`

    const blocked = await postJson(
      `${base}/blocks`,
      { conversationId: conversation.id, reason: 'Mensagens ofensivas' },
      user.cookie,
    )
    expect(blocked.status).toBe(201)
    const { data } = await blocked.json()
    expect(data.block).toMatchObject({
      connectionId: connection.id,
      contactId: contact.id,
      waId: contact.waId,
      reason: 'Mensagens ofensivas',
      providerStatus: 'FAILED',
      origin: 'STEEL',
      blockedBy: { id: user.id },
    })
    expect(data.notice).toContain('Contato bloqueado no Steel')

    const again = await postJson(
      `${base}/blocks`,
      { conversationId: conversation.id },
      user.cookie,
    )
    expect(again.status).toBe(201)
    expect((await again.json()).data.block.id).toBe(data.block.id)

    const state = await getJson(
      `${base}/conversations/${conversation.id}/block`,
      user.cookie,
    )
    expect(state.status).toBe(200)
    expect((await state.json()).data).toMatchObject({
      supported: true,
      provider: 'META',
      canBlock: true,
      canUnblock: true,
      block: { id: data.block.id },
    })

    const list = await getJson(`${base}/blocks`, user.cookie)
    expect((await list.json()).data.map((row: { id: string }) => row.id)).toEqual(
      [data.block.id],
    )
    const contacts = await getJson(`${base}/contacts`, user.cookie)
    const listed = (await contacts.json()).data.find(
      (row: { id: string }) => row.id === contact.id,
    )
    expect(listed.blocked).toBe(true)

    // The send layer refuses the blocked recipient.
    const send = await postJson(
      `${base}/conversations/${conversation.id}/messages`,
      { text: 'Oi' },
      user.cookie,
    )
    expect(send.status).toBe(409)
    expect((await send.json()).error.code).toBe('WHATSAPP_CONTACT_BLOCKED')

    const removed = await deleteJson(
      `${base}/blocks/${data.block.id}`,
      user.cookie,
    )
    expect(removed.status).toBe(200)
    expect((await removed.json()).data).toEqual({
      id: data.block.id,
      providerWarning: null,
    })
    const empty = await getJson(`${base}/blocks`, user.cookie)
    expect((await empty.json()).data).toEqual([])
    const gone = await deleteJson(
      `${base}/blocks/${data.block.id}`,
      user.cookie,
    )
    expect(gone.status).toBe(404)
  })

  it('should let an agent block their conversation but not unblock, list or sync', async () => {
    const { user, workspace } = await authenticatedOwner()
    const agent = await addMember(workspace.id, 'MEMBER')
    const viewer = await addMember(workspace.id, 'VIEWER')
    const mine = await seedConversation(workspace.id, user.id, agent.id)
    const notMine = await seedConversation(workspace.id, user.id, user.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp`

    const hidden = await postJson(
      `${base}/blocks`,
      { conversationId: notMine.conversation.id },
      agent.cookie,
    )
    expect(hidden.status).toBe(404)

    const byViewer = await postJson(
      `${base}/blocks`,
      { conversationId: mine.conversation.id },
      viewer.cookie,
    )
    expect(byViewer.status).toBe(403)

    const blocked = await postJson(
      `${base}/blocks`,
      { conversationId: mine.conversation.id },
      agent.cookie,
    )
    expect(blocked.status).toBe(201)
    const blockId = (await blocked.json()).data.block.id

    const state = await getJson(
      `${base}/conversations/${mine.conversation.id}/block`,
      agent.cookie,
    )
    expect((await state.json()).data).toMatchObject({
      canBlock: true,
      canUnblock: false,
    })

    const byContact = await postJson(
      `${base}/blocks`,
      {
        connectionId: notMine.connection.id,
        contactId: notMine.contact.id,
      },
      agent.cookie,
    )
    expect(byContact.status).toBe(403)
    expect((await getJson(`${base}/blocks`, agent.cookie)).status).toBe(403)
    expect(
      (await deleteJson(`${base}/blocks/${blockId}`, agent.cookie)).status,
    ).toBe(403)
    expect((await postJson(`${base}/blocks/sync`, {}, agent.cookie)).status).toBe(
      403,
    )
  })

  it('should validate the body and hide other workspaces', async () => {
    const { user, workspace } = await authenticatedOwner()
    const other = await authenticatedOwner()
    const foreign = await seedConversation(other.workspace.id, other.user.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp`

    expect((await postJson(`${base}/blocks`, {}, user.cookie)).status).toBe(422)
    const longReason = await postJson(
      `${base}/blocks`,
      { conversationId: 'x', reason: 'x'.repeat(501) },
      user.cookie,
    )
    expect(longReason.status).toBe(422)

    const cross = await postJson(
      `${base}/blocks`,
      { conversationId: foreign.conversation.id },
      user.cookie,
    )
    expect(cross.status).toBe(404)
    const crossContact = await postJson(
      `${base}/blocks`,
      {
        connectionId: foreign.connection.id,
        contactId: foreign.contact.id,
      },
      user.cookie,
    )
    expect(crossContact.status).toBe(404)
    const crossState = await getJson(
      `${base}/conversations/${foreign.conversation.id}/block`,
      user.cookie,
    )
    expect(crossState.status).toBe(404)
    const outsider = await getJson(
      `/api/workspaces/${other.workspace.id}/whatsapp/blocks`,
      user.cookie,
    )
    expect(outsider.status).toBe(403)
  })

  it('should sync every number and report the ones without credentials', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { connection } = await seedConversation(workspace.id, user.id)
    const base = `/api/workspaces/${workspace.id}/whatsapp/blocks/sync`

    const all = await postJson(base, {}, user.cookie)
    expect(all.status).toBe(200)
    const rows = (await all.json()).data.connections
    expect(rows).toEqual([
      expect.objectContaining({
        connectionId: connection.id,
        imported: 0,
        error: expect.stringContaining('sem credenciais'),
      }),
    ])

    const unknown = await postJson(
      base,
      { connectionId: 'does-not-exist' },
      user.cookie,
    )
    expect(unknown.status).toBe(404)
  })
})
