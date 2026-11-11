import { describe, expect, it } from 'vitest'
import { sampleDocumentContent } from '@/src/__tests__/factories/document-backend.factory'
import {
  authenticatedOwner,
  getJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'

async function sentDocument() {
  const { user, workspace } = await authenticatedOwner()
  const root = `/api/workspaces/${workspace.id}/crm/documents`
  const created = await postJson(
    root,
    { title: 'Proposta', kind: 'PROPOSAL' },
    user.cookie,
  )
  const doc = (await created.json()).data
  await putJson(
    `${root}/${doc.id}/content`,
    { content: sampleDocumentContent({ fields: true, pricing: true }) },
    user.cookie,
  )
  const sent = await postJson(
    `${root}/${doc.id}/send`,
    {
      recipients: [
        { name: 'Maria', channel: 'LINK' },
        { name: 'Leitor', role: 'VIEWER', channel: 'LINK' },
      ],
    },
    user.cookie,
  )
  const body = (await sent.json()).data
  const tokenOf = (url: string) => url.split('/d/')[1]
  return {
    generic: body.publicToken as string,
    approver: tokenOf(body.recipients[0].url),
    viewer: tokenOf(body.recipients[1].url),
    versionId: body.currentVersion.id as string,
  }
}

const accept = (token: string, body: Record<string, unknown>) =>
  postJson(`/api/documents/${token}/accept`, body)

describe('public document link', () => {
  it('answers 410 for an unknown token, without a session', async () => {
    const res = await getJson('/api/documents/unknown-token')
    expect(res.status).toBe(410)
    expect((await res.json()).error.code).toBe('DOCUMENT_LINK_UNAVAILABLE')
  })

  it('reads, identifies and accepts once', async () => {
    const link = await sentDocument()

    const read = await getJson(`/api/documents/${link.generic}`)
    expect(read.status).toBe(200)
    const data = (await read.json()).data
    expect(data.version.id).toBe(link.versionId)
    expect(data.canAccept).toBe(true)

    const identified = await postJson(
      `/api/documents/${link.generic}/identify`,
      { name: 'Paulo Leitor', email: 'paulo@example.com' },
    )
    expect(identified.status).toBe(200)
    expect((await identified.json()).data.token).not.toBe(link.generic)

    const viewerAccept = await accept(link.viewer, {
      name: 'Leitor',
      agreed: true,
      fields: { 'field-name': 'Leitor' },
      versionId: link.versionId,
    })
    expect(viewerAccept.status).toBe(403)

    const missingField = await accept(link.approver, {
      name: 'Maria',
      agreed: true,
      versionId: link.versionId,
    })
    expect(missingField.status).toBe(422)

    const stale = await accept(link.approver, {
      name: 'Maria',
      agreed: true,
      fields: { 'field-name': 'Maria' },
      versionId: 'old-version',
    })
    expect(stale.status).toBe(409)

    const accepted = await accept(link.approver, {
      name: 'Maria',
      agreed: true,
      fields: { 'field-name': 'Maria Souza' },
      selection: { extra: { selected: true, quantity: 1 } },
      versionId: link.versionId,
    })
    expect(accepted.status).toBe(200)
    expect((await accepted.json()).data.document.status).toBe('ACCEPTED')

    const again = await postJson(`/api/documents/${link.generic}/decline`, {
      versionId: link.versionId,
    })
    expect(again.status).toBe(409)
    expect((await again.json()).error.code).toBe('DOCUMENT_ALREADY_ANSWERED')
  })
})
