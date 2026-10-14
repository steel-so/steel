import { describe, expect, it } from 'vitest'
import {
  seedWikiPage,
  withWiki,
} from '@/src/__tests__/factories/wiki-page.factory'
import { authenticatedOwner, postJson } from '@/src/__tests__/helpers/e2e'

// The provider call itself is covered by the service unit tests: e2e runs
// without AI keys, so only the gates before it are exercised here.
describe('POST /api/workspaces/[id]/wiki/[wikiPageId]/ai', () => {
  it('should return 422 for an unknown action', async () => {
    const { user, workspace } = await withWiki(authenticatedOwner())
    const page = await seedWikiPage(workspace.id, user.id)

    const res = await postJson(
      `/api/workspaces/${workspace.id}/wiki/${page.id}/ai`,
      { action: 'translate', text: 'oi' },
      user.cookie,
    )

    expect(res.status).toBe(422)
  })

  it('should return 422 for text over the limit', async () => {
    const { user, workspace } = await withWiki(authenticatedOwner())
    const page = await seedWikiPage(workspace.id, user.id)

    const res = await postJson(
      `/api/workspaces/${workspace.id}/wiki/${page.id}/ai`,
      { action: 'summarize', text: 'x'.repeat(20_001) },
      user.cookie,
    )

    expect(res.status).toBe(422)
  })

  it('should return 403 for a non-member', async () => {
    const { user, workspace } = await withWiki(authenticatedOwner())
    const other = await withWiki(authenticatedOwner())
    const page = await seedWikiPage(workspace.id, user.id)

    const res = await postJson(
      `/api/workspaces/${workspace.id}/wiki/${page.id}/ai`,
      { action: 'title', text: 'Um texto qualquer' },
      other.user.cookie,
    )

    expect(res.status).toBe(403)
  })
})
