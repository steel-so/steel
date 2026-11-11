import { describe, expect, it } from 'vitest'
import { seedDocument } from '@/src/__tests__/factories/document-pdf.factory'
import {
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const exportsPath = (workspaceId: string, documentId: string) =>
  `/api/workspaces/${workspaceId}/crm/documents/${documentId}/exports`

describe('POST /api/workspaces/[id]/crm/documents/[documentId]/exports', () => {
  it('should return 401 via middleware when unauthenticated', async () => {
    const res = await fetch(`${BASE_URL}${exportsPath('ws', 'doc')}`, {
      method: 'POST',
      headers: defaultHeaders,
      body: '{}',
    })
    expect(res.status).toBe(401)
  })

  it('should return 403 when the user is not a workspace member', async () => {
    const { user, workspace } = await authenticatedOwner()
    const document = await seedDocument(workspace.id, user.id)
    const stranger = await createAuthenticatedUser()

    const res = await postJson(
      exportsPath(workspace.id, document.id),
      {},
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })

  it('should return 404 for a document of another workspace', async () => {
    const { user } = await authenticatedOwner()
    const other = await authenticatedOwner()
    const document = await seedDocument(other.workspace.id, other.user.id)

    const res = await postJson(
      exportsPath(other.workspace.id, 'missing'),
      {},
      other.user.cookie,
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('DOCUMENT_NOT_FOUND')

    const denied = await postJson(
      exportsPath(other.workspace.id, document.id),
      {},
      user.cookie,
    )
    expect(denied.status).toBe(403)
  })

  it('should reject an invalid body', async () => {
    const { user, workspace } = await authenticatedOwner()
    const document = await seedDocument(workspace.id, user.id)
    const res = await postJson(
      exportsPath(workspace.id, document.id),
      { draft: 'yes' },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('should queue a draft export, reuse it and report its status', async () => {
    const { user, workspace } = await authenticatedOwner()
    const document = await seedDocument(workspace.id, user.id)
    const path = exportsPath(workspace.id, document.id)

    const created = await postJson(path, {}, user.cookie)
    expect(created.status).toBe(201)
    const { data } = await created.json()
    expect(data).toMatchObject({
      status: 'PENDING',
      versionNumber: null,
      downloadUrl: null,
    })

    const again = await postJson(path, { draft: true }, user.cookie)
    expect((await again.json()).data.id).toBe(data.id)

    const status = await getJson(`${path}/${data.id}`, user.cookie)
    expect(status.status).toBe(200)
    expect((await status.json()).data.id).toBe(data.id)

    const missing = await getJson(`${path}/missing`, user.cookie)
    expect(missing.status).toBe(404)
    expect((await missing.json()).error.code).toBe('DOCUMENT_EXPORT_NOT_FOUND')

    const download = await getJson(`${path}/${data.id}/download`, user.cookie)
    expect(download.status).toBe(404)
    expect((await download.json()).error.code).toBe(
      'DOCUMENT_EXPORT_NOT_FOUND',
    )
  })
})
