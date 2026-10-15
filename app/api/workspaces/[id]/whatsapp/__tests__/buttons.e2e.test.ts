import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

let counter = 0
function suffix() {
  counter += 1
  return `${Date.now()}${counter}`
}

async function seedTemplate(workspaceId: string, userId: string) {
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'META',
      label: 'Meta',
      phoneNumber: `5511${suffix()}`,
      metaPhoneNumberId: `ph-${suffix()}`,
      createdById: userId,
    },
  })
  return prisma.whatsAppTemplate.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      name: 'promo',
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'APPROVED',
      components: [
        { type: 'BODY', text: 'Oferta!' },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Quero' }] },
      ],
    },
  })
}

const actions = [
  { kind: 'REPLY', text: 'Já te chamo!' },
  { kind: 'SET_STATUS', status: 'IN_PROGRESS' },
]

describe('PATCH /api/workspaces/[id]/whatsapp/templates/[templateId]/buttons', () => {
  it('saves the actions of a synced template', async () => {
    const { user, workspace } = await authenticatedOwner()
    const template = await seedTemplate(workspace.id, user.id)
    const url = `/api/workspaces/${workspace.id}/whatsapp/templates/${template.id}/buttons`

    const res = await patchJson(
      url,
      { buttons: [{ id: 'b1', type: 'REPLY', label: 'Quero', actions }] },
      user.cookie,
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.buttons).toEqual([
      { id: 'b1', type: 'REPLY', label: 'Quero', actions },
    ])
  })

  it('refuses buttons that differ from the approved ones', async () => {
    const { user, workspace } = await authenticatedOwner()
    const template = await seedTemplate(workspace.id, user.id)
    const url = `/api/workspaces/${workspace.id}/whatsapp/templates/${template.id}/buttons`

    const res = await patchJson(
      url,
      { buttons: [{ id: 'b1', type: 'REPLY', label: 'Outro', actions }] },
      user.cookie,
    )
    expect(res.status).toBe(422)

    const invalid = await patchJson(
      url,
      { buttons: [{ id: 'b1', type: 'REPLY', label: 'x'.repeat(30) }] },
      user.cookie,
    )
    expect(invalid.status).toBe(422)
  })

  it('is admin-only and 404s an unknown template', async () => {
    const { workspace } = await authenticatedOwner()
    const member = await addMember(workspace.id, 'MEMBER')
    const base = `/api/workspaces/${workspace.id}/whatsapp/templates`

    const forbidden = await patchJson(
      `${base}/missing/buttons`,
      { buttons: [] },
      member.cookie,
    )
    expect(forbidden.status).toBe(403)

    const unauthenticated = await patchJson(`${base}/missing/buttons`, {
      buttons: [],
    })
    expect(unauthenticated.status).toBe(401)
  })

  it('404s an unknown template for the owner', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await patchJson(
      `/api/workspaces/${workspace.id}/whatsapp/templates/missing/buttons`,
      { buttons: [] },
      user.cookie,
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/workspaces/[id]/whatsapp/conversations/[conversationId]/messages/quick-reply', () => {
  it('validates the body and 404s an unknown conversation', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/conversations/missing/messages/quick-reply`

    const invalid = await postJson(base, {}, user.cookie)
    expect(invalid.status).toBe(422)

    const missing = await postJson(base, { quickReplyId: 'qr1' }, user.cookie)
    expect(missing.status).toBe(404)
    expect((await missing.json()).error.code).toBe(
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )

    const unauthenticated = await postJson(base, { quickReplyId: 'qr1' })
    expect(unauthenticated.status).toBe(401)
  })
})
