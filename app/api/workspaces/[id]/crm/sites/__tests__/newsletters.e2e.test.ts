import { describe, expect, it } from 'vitest'
import {
  seedArchiveIssue,
  seedArchiveNewsletter,
} from '@/src/__tests__/factories/newsletter-archive.factory'
import {
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

describe('GET /api/workspaces/[id]/crm/sites/newsletters', () => {
  it('returns 401 without a session', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/x/crm/sites/newsletters`,
      { headers: defaultHeaders },
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 to a non-member', async () => {
    const { workspace } = await authenticatedOwner()
    const stranger = await createAuthenticatedUser()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/sites/newsletters`,
      stranger.cookie,
    )
    expect(res.status).toBe(403)
  })

  it('lists the ACTIVE newsletters with their sent issues', async () => {
    const { user, workspace } = await authenticatedOwner()
    const newsletter = await seedArchiveNewsletter(workspace.id, user.id, {
      name: 'Novidades',
    })
    await seedArchiveNewsletter(workspace.id, user.id, { status: 'ARCHIVED' })
    const issue = await seedArchiveIssue(newsletter, { number: 1 })

    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/sites/newsletters`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({
      id: newsletter.id,
      name: 'Novidades',
      workspaceSlug: workspace.slug,
      archiveEnabled: true,
    })
    expect(data[0].archiveUrl).toMatch(
      new RegExp(`/n/${workspace.slug}/${newsletter.slug}$`),
    )
    expect(data[0].issues[0].slug).toBe(issue.slug)
  })
})
