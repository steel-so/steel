import { describe, expect, it } from 'vitest'
import {
  seedWikiPage,
  withWiki,
} from '@/src/__tests__/factories/wiki-page.factory'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  patchJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'

const base = (workspaceId: string, pageId: string) =>
  `/api/workspaces/${workspaceId}/wiki/${pageId}`

describe('POST/DELETE /api/workspaces/[id]/wiki/[wikiPageId]/lock', () => {
  it('should let the author lock and make the page read-only for members', async () => {
    const { user, workspace } = await withWiki(authenticatedOwner())
    const author = await addMember(workspace.id)
    const member = await addMember(workspace.id)
    const page = await seedWikiPage(workspace.id, author.id)

    const lock = await postJson(
      `${base(workspace.id, page.id)}/lock`,
      {},
      author.cookie,
    )
    expect(lock.status).toBe(200)
    const { data } = await lock.json()
    expect(data.lockedAt).not.toBeNull()
    expect(data.lockedById).toBe(author.id)
    expect(data.canManageLock).toBe(true)

    const edit = await patchJson(
      base(workspace.id, page.id),
      { title: 'x' },
      member.cookie,
    )
    expect(edit.status).toBe(423)
    expect((await edit.json()).error.code).toBe('WIKI_PAGE_LOCKED')

    const labels = await putJson(
      `${base(workspace.id, page.id)}/labels`,
      { labelIds: [] },
      member.cookie,
    )
    expect(labels.status).toBe(423)

    // The workspace owner still edits.
    const ownerEdit = await patchJson(
      base(workspace.id, page.id),
      { title: 'Pelo dono' },
      user.cookie,
    )
    expect(ownerEdit.status).toBe(200)
    expect((await ownerEdit.json()).data.canManageLock).toBe(true)
  })

  it('should return 403 WIKI_LOCK_FORBIDDEN for a member who is not the author', async () => {
    const { user, workspace } = await withWiki(authenticatedOwner())
    const page = await seedWikiPage(workspace.id, user.id)
    const member = await addMember(workspace.id)

    const res = await postJson(
      `${base(workspace.id, page.id)}/lock`,
      {},
      member.cookie,
    )

    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('WIKI_LOCK_FORBIDDEN')
  })

  it('should let an admin unlock and restore editing', async () => {
    const { workspace } = await withWiki(authenticatedOwner())
    const author = await addMember(workspace.id)
    const admin = await addMember(workspace.id, 'ADMIN')
    const member = await addMember(workspace.id)
    const page = await seedWikiPage(workspace.id, author.id, {
      lockedAt: new Date(),
      lockedById: author.id,
    })

    const res = await deleteJson(
      `${base(workspace.id, page.id)}/lock`,
      admin.cookie,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data.lockedAt).toBeNull()

    const edit = await patchJson(
      base(workspace.id, page.id),
      { title: 'De volta' },
      member.cookie,
    )
    expect(edit.status).toBe(200)
  })
})
