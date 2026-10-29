import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'
import { CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS } from '@/src/schemas/crm-newsletter-automation.schema'

async function seed() {
  const { user, workspace } = await authenticatedOwner()
  const newsletter = await prisma.crmNewsletter.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: 'Novidades',
      slug: 'novidades',
      fromName: 'Acme',
      fromEmail: 'news@news.acme-e2e.com.br',
    },
  })
  const base = `/api/workspaces/${workspace.id}/crm/newsletters/${newsletter.id}/reengagement`
  return { user, workspace, newsletter, base }
}

describe('/api/workspaces/[id]/crm/newsletters/[newsletterId]/reengagement', () => {
  it('returns 401 without a session', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/x/crm/newsletters/y/reengagement`,
      { headers: defaultHeaders },
    )
    expect(res.status).toBe(401)
  })

  it('denies strangers and VIEWERs writing', async () => {
    const { workspace, base } = await seed()
    const stranger = await createAuthenticatedUser()
    expect((await getJson(base, stranger.cookie)).status).toBe(403)
    const viewer = await addMember(workspace.id, 'VIEWER')
    expect((await getJson(base, viewer.cookie)).status).toBe(200)
    expect(
      (await putJson(base, CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS, viewer.cookie))
        .status,
    ).toBe(403)
  })

  it('starts off, saves, previews and validates', async () => {
    const { user, base } = await seed()
    const initial = (await (await getJson(base, user.cookie)).json()).data
    expect(initial).toMatchObject({
      saved: false,
      enabled: false,
      minIssues: 3,
      preview: { candidates: 0, waiting: 0, dueNow: 0 },
    })

    const saved = await putJson(
      base,
      {
        ...CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS,
        enabled: true,
        action: 'FLAG',
        graceDays: 14,
      },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    expect((await saved.json()).data).toMatchObject({
      saved: true,
      enabled: true,
      action: 'FLAG',
      graceDays: 14,
    })

    const preview = await getJson(
      `${base}/preview?minIssues=1&inactiveDays=30`,
      user.cookie,
    )
    expect(preview.status).toBe(200)
    expect((await preview.json()).data).toEqual({
      candidates: 0,
      waiting: 0,
      dueNow: 0,
    })
    expect(
      (await getJson(`${base}/preview?inactiveDays=5`, user.cookie)).status,
    ).toBe(422)
    expect(
      (
        await putJson(
          base,
          { ...CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS, minIssues: 0 },
          user.cookie,
        )
      ).status,
    ).toBe(422)
  })
})
