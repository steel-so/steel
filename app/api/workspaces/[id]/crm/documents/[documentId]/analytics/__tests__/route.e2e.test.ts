import { describe, expect, it } from 'vitest'
import {
  seedDocument,
  seedSession,
} from '@/src/__tests__/factories/document-analytics.factory'
import {
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

const path = (workspaceId: string, documentId: string, query = '') =>
  `/api/workspaces/${workspaceId}/crm/documents/${documentId}/analytics${query}`

describe('GET /api/workspaces/[id]/crm/documents/[documentId]/analytics', () => {
  it('returns 401 via middleware when unauthenticated', async () => {
    const res = await fetch(`${BASE_URL}${path('ws', 'doc')}`, {
      headers: defaultHeaders,
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 to someone outside the workspace', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { document } = await seedDocument({
      workspaceId: workspace.id,
      ownerId: user.id,
    })
    const stranger = await createAuthenticatedUser()

    const res = await getJson(path(workspace.id, document.id), stranger.cookie)
    expect(res.status).toBe(403)
  })

  it('aggregates the reading sessions of the document', async () => {
    const { user, workspace } = await authenticatedOwner()
    const { document } = await seedDocument({
      workspaceId: workspace.id,
      ownerId: user.id,
    })
    await seedSession({
      documentId: document.id,
      workspaceId: workspace.id,
      activeMs: 42_000,
      maxScrollPct: 100,
      reachedEnd: true,
    })

    const res = await getJson(path(workspace.id, document.id), user.cookie)
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.totals).toMatchObject({
      sessions: 1,
      uniqueVisitors: 1,
      totalActiveMs: 42_000,
      completionRate: 1,
    })
    expect(data.sections.map((s: { name: string }) => s.name)).toEqual([
      'Introdução',
      'Escopo',
      'Investimento',
    ])

    const week = await getJson(
      path(workspace.id, document.id, '?days=7'),
      user.cookie,
    )
    expect((await week.json()).data.daily).toHaveLength(7)
  })

  it('answers 404 for an unknown document and 422 for a bad period', async () => {
    const { user, workspace } = await authenticatedOwner()

    const missing = await getJson(path(workspace.id, 'missing'), user.cookie)
    expect(missing.status).toBe(404)
    expect((await missing.json()).error.code).toBe('DOCUMENT_NOT_FOUND')

    const bad = await getJson(
      path(workspace.id, 'missing', '?days=14'),
      user.cookie,
    )
    expect(bad.status).toBe(422)
  })
})
