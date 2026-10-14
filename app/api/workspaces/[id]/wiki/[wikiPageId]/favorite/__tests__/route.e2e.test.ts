import { describe, expect, it } from 'vitest'
import {
  seedWikiPage,
  withWiki,
} from '@/src/__tests__/factories/wiki-page.factory'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'

describe('PUT/DELETE /api/workspaces/[id]/wiki/[wikiPageId]/favorite', () => {
  it('should favorite per user and show it in the list', async () => {
    const { user, workspace } = await withWiki(authenticatedOwner())
    const page = await seedWikiPage(workspace.id, user.id)
    const member = await addMember(workspace.id)
    const url = `/api/workspaces/${workspace.id}/wiki/${page.id}/favorite`

    const put = await putJson(url, {}, user.cookie)
    expect(put.status).toBe(200)
    expect((await put.json()).data.isFavorite).toBe(true)

    const mine = await getJson(
      `/api/workspaces/${workspace.id}/wiki`,
      user.cookie,
    )
    expect((await mine.json()).data[0].isFavorite).toBe(true)

    const theirs = await getJson(
      `/api/workspaces/${workspace.id}/wiki`,
      member.cookie,
    )
    expect((await theirs.json()).data[0].isFavorite).toBe(false)

    const del = await deleteJson(url, user.cookie)
    expect(del.status).toBe(200)
    expect((await del.json()).data.isFavorite).toBe(false)
  })

  it('should return 403 for a page of another workspace', async () => {
    const { user, workspace } = await withWiki(authenticatedOwner())
    const other = await withWiki(authenticatedOwner())
    const page = await seedWikiPage(other.workspace.id, other.user.id)

    const res = await putJson(
      `/api/workspaces/${workspace.id}/wiki/${page.id}/favorite`,
      {},
      user.cookie,
    )

    expect(res.status).toBe(403)
  })
})
