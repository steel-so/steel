import { describe, expect, it } from 'vitest'
import {
  seedWikiPage,
  withWiki,
} from '@/src/__tests__/factories/wiki-page.factory'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'

const url = (workspaceId: string, pageId: string) =>
  `/api/workspaces/${workspaceId}/wiki/${pageId}/publish`

describe('POST/DELETE /api/workspaces/[id]/wiki/[wikiPageId]/publish', () => {
  it('should publish with a 32-char token and keep it on repeat', async () => {
    const { user, workspace } = await withWiki(authenticatedOwner())
    const page = await seedWikiPage(workspace.id, user.id)

    const res = await postJson(url(workspace.id, page.id), {}, user.cookie)

    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.publicToken).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(data.publishedAt).not.toBeNull()

    const again = await postJson(url(workspace.id, page.id), {}, user.cookie)
    expect((await again.json()).data.publicToken).toBe(data.publicToken)
  })

  it('should revoke the link on DELETE', async () => {
    const { user, workspace } = await withWiki(authenticatedOwner())
    const page = await seedWikiPage(workspace.id, user.id, {
      publicToken: 'e'.repeat(32),
      publishedAt: new Date(),
    })

    const res = await deleteJson(url(workspace.id, page.id), user.cookie)

    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.publicToken).toBeNull()
    expect(data.publishedAt).toBeNull()
  })

  it('should return 423 for a member on a page locked by someone else', async () => {
    const { user, workspace } = await withWiki(authenticatedOwner())
    const page = await seedWikiPage(workspace.id, user.id, {
      lockedAt: new Date(),
      lockedById: user.id,
    })
    const member = await addMember(workspace.id)

    const res = await postJson(url(workspace.id, page.id), {}, member.cookie)

    expect(res.status).toBe(423)
    expect((await res.json()).error.code).toBe('WIKI_PAGE_LOCKED')
  })

  it('should return 401 without a session', async () => {
    const res = await postJson(url('ws', 'page'), {})
    expect(res.status).toBe(401)
  })
})
