import { describe, expect, it } from 'vitest'
import { sampleDocumentContent } from '@/src/__tests__/factories/document-backend.factory'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  deleteJson,
  getJson,
  patchJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/crm/documents`

describe('GET /api/workspaces/[id]/crm/documents', () => {
  it('returns 401 via middleware when unauthenticated', async () => {
    const res = await fetch(`${BASE_URL}${base('some-id')}`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 for a user outside the workspace', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    const res = await getJson(base(workspace.id), stranger.cookie)
    expect(res.status).toBe(403)
  })

  it('returns 422 for an invalid query', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(`${base(workspace.id)}?page=0`, user.cookie)
    expect(res.status).toBe(422)
  })
})

describe('documents lifecycle', () => {
  it('creates, edits, saves, sends, duplicates and deletes a document', async () => {
    const { user, workspace } = await authenticatedOwner()
    const root = base(workspace.id)

    const created = await postJson(
      root,
      { title: 'Proposta Acme', kind: 'PROPOSAL' },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const doc = (await created.json()).data
    expect(doc.status).toBe('DRAFT')
    expect(doc.validUntil).not.toBeNull()

    const list = await getJson(root, user.cookie)
    expect((await list.json()).data.total).toBe(1)

    const patched = await patchJson(
      `${root}/${doc.id}`,
      { description: 'Para a diretoria', settings: { showToc: true } },
      user.cookie,
    )
    expect(patched.status).toBe(200)
    const patchedBody = (await patched.json()).data
    expect(patchedBody.settings.showToc).toBe(true)
    expect(patchedBody.settings.allowDownload).toBe(true)

    const saved = await putJson(
      `${root}/${doc.id}/content`,
      {
        content: sampleDocumentContent(),
        baseUpdatedAt: patchedBody.updatedAt,
      },
      user.cookie,
    )
    expect(saved.status).toBe(200)

    const conflict = await putJson(
      `${root}/${doc.id}/content`,
      {
        content: sampleDocumentContent(),
        baseUpdatedAt: patchedBody.updatedAt,
      },
      user.cookie,
    )
    expect(conflict.status).toBe(409)

    const sent = await postJson(
      `${root}/${doc.id}/send`,
      {
        recipients: [
          { name: 'Maria', channel: 'LINK' },
          {
            name: 'Leitor',
            role: 'VIEWER',
            channel: 'WHATSAPP',
            phone: '11988887777',
          },
        ],
      },
      user.cookie,
    )
    expect(sent.status).toBe(200)
    const sentBody = (await sent.json()).data
    expect(sentBody.status).toBe('SENT')
    expect(sentBody.currentVersion.number).toBe(1)
    expect(sentBody.recipients).toHaveLength(2)
    expect(sentBody.deliveries[1]).toMatchObject({
      requested: 'WHATSAPP',
      channel: 'LINK',
      delivered: false,
    })

    const versions = await getJson(`${root}/${doc.id}/versions`, user.cookie)
    expect((await versions.json()).data).toHaveLength(1)
    const events = await getJson(`${root}/${doc.id}/events`, user.cookie)
    const types = (await events.json()).data.map(
      (event: { type: string }) => event.type,
    )
    expect(types).toContain('CREATED')
    expect(types).toContain('SENT')

    const added = await postJson(
      `${root}/${doc.id}/recipients`,
      { recipients: [{ name: 'Ana', channel: 'LINK' }] },
      user.cookie,
    )
    expect(added.status).toBe(201)
    const recipient = (await added.json()).data[0]

    const single = await postJson(
      `${root}/${doc.id}/recipients`,
      { name: 'Bia', email: 'bia@example.com', channel: 'EMAIL' },
      user.cookie,
    )
    expect(single.status).toBe(201)
    expect((await single.json()).data).toMatchObject({
      name: 'Bia',
      delivery: { requested: 'EMAIL' },
    })

    const resent = await postJson(
      `${root}/${doc.id}/recipients/${recipient.id}/resend`,
      {},
      user.cookie,
    )
    expect(resent.status).toBe(200)

    const removed = await deleteJson(
      `${root}/${doc.id}/recipients/${recipient.id}`,
      user.cookie,
    )
    expect(removed.status).toBe(200)

    const responses = await getJson(`${root}/${doc.id}/responses`, user.cookie)
    expect((await responses.json()).data).toEqual([])

    const copy = await postJson(
      `${root}/${doc.id}/duplicate`,
      { asTemplate: true },
      user.cookie,
    )
    expect(copy.status).toBe(201)
    expect((await copy.json()).data.isTemplate).toBe(true)

    const deleted = await deleteJson(`${root}/${doc.id}`, user.cookie)
    expect(deleted.status).toBe(200)
    const gone = await getJson(`${root}/${doc.id}`, user.cookie)
    expect(gone.status).toBe(404)
  })

  it('refuses to delete for a MEMBER and to edit for a VIEWER', async () => {
    const { user, workspace } = await authenticatedOwner()
    const root = base(workspace.id)
    const created = await postJson(root, { title: 'Contrato' }, user.cookie)
    const doc = (await created.json()).data

    const member = await addMember(workspace.id, 'MEMBER')
    const memberDelete = await deleteJson(`${root}/${doc.id}`, member.cookie)
    expect(memberDelete.status).toBe(403)

    const viewer = await addMember(workspace.id, 'VIEWER')
    const viewerEdit = await patchJson(
      `${root}/${doc.id}`,
      { title: 'Outro' },
      viewer.cookie,
    )
    expect(viewerEdit.status).toBe(403)
    const viewerRead = await getJson(`${root}/${doc.id}`, viewer.cookie)
    expect(viewerRead.status).toBe(200)
  })

  it('refuses to send an empty document', async () => {
    const { user, workspace } = await authenticatedOwner()
    const root = base(workspace.id)
    const created = await postJson(root, { title: 'Vazio' }, user.cookie)
    const doc = (await created.json()).data
    const res = await postJson(
      `${root}/${doc.id}/send`,
      { recipients: [] },
      user.cookie,
    )
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('DOCUMENT_EMPTY')
  })
})
