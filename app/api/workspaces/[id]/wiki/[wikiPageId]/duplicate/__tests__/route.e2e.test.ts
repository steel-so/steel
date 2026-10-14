import { describe, expect, it } from 'vitest'
import {
  seedWikiPage,
  withWiki,
} from '@/src/__tests__/factories/wiki-page.factory'
import {
  addMember,
  authenticatedOwner,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

describe('POST /api/workspaces/[id]/wiki/[wikiPageId]/duplicate', () => {
  it('should copy the page right after the original, with the yjs state', async () => {
    const { user, workspace } = await withWiki(authenticatedOwner())
    const page = await seedWikiPage(workspace.id, user.id, {
      title: 'Manual',
      content: [{ type: 'p', children: [{ text: 'olá' }] }],
      yjsState: new Uint8Array([1, 2, 3]),
      lockedAt: new Date(),
      lockedById: user.id,
    })
    const member = await addMember(workspace.id)

    const res = await postJson(
      `/api/workspaces/${workspace.id}/wiki/${page.id}/duplicate`,
      {},
      member.cookie,
    )

    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.id).not.toBe(page.id)
    expect(data.title).toBe('Manual (cópia)')
    expect(data.content).toEqual([{ type: 'p', children: [{ text: 'olá' }] }])
    expect(data.position).toBe(page.position + 1)
    expect(data.lockedAt).toBeNull()
    expect(data.createdById).toBe(member.id)
    const stored = await prisma.wikiPage.findUniqueOrThrow({
      where: { id: data.id },
    })
    expect(Buffer.from(stored.yjsState as Uint8Array)).toEqual(
      Buffer.from([1, 2, 3]),
    )
  })

  it('should return 403 for a non-member', async () => {
    const { user, workspace } = await withWiki(authenticatedOwner())
    const other = await withWiki(authenticatedOwner())
    const page = await seedWikiPage(workspace.id, user.id)

    const res = await postJson(
      `/api/workspaces/${workspace.id}/wiki/${page.id}/duplicate`,
      {},
      other.user.cookie,
    )

    expect(res.status).toBe(403)
  })
})
