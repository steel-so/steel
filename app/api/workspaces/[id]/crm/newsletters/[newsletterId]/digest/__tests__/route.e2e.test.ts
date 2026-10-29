import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  deleteJson,
  getJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

/** newsletter2 nl2-digest-ai: digest, AI sources and the subject A/B test. */

async function seed(subscribers = 0) {
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
  const site = await prisma.site.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: 'Site Acme',
      slug: `acme-${workspace.id.slice(-8)}`,
      publishedAt: new Date(),
    },
  })
  await prisma.sitePost.create({
    data: {
      siteId: site.id,
      createdById: user.id,
      title: 'Post da semana',
      slug: 'post-da-semana',
      status: 'PUBLISHED',
      publishedAt: new Date(Date.now() - 86_400_000),
    },
  })
  for (let i = 0; i < subscribers; i++) {
    await prisma.crmNewsletterSubscriber.create({
      data: {
        newsletterId: newsletter.id,
        workspaceId: workspace.id,
        email: `p${i}@acme-e2e.com.br`,
        status: 'ACTIVE',
        source: 'MANUAL',
      },
    })
  }
  const base = `/api/workspaces/${workspace.id}/crm/newsletters/${newsletter.id}`
  return { user, workspace, newsletter, site, base }
}

const SETTINGS = {
  enabled: true,
  cadence: 'WEEKLY',
  weekday: 1,
  hour: 9,
  mode: 'DRAFT',
  maxItems: 5,
  subject: 'Resumo de {data}',
}

describe('/api/workspaces/[id]/crm/newsletters/[newsletterId]/digest', () => {
  it('returns 401 without a session', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/x/crm/newsletters/y/digest`,
      { headers: defaultHeaders },
    )
    expect(res.status).toBe(401)
  })

  it('denies strangers and read-only members writing', async () => {
    const { workspace, site, base } = await seed()
    const stranger = await createAuthenticatedUser()
    expect((await getJson(`${base}/digest`, stranger.cookie)).status).toBe(403)
    const viewer = await addMember(workspace.id, 'VIEWER')
    expect((await getJson(`${base}/digest`, viewer.cookie)).status).toBe(200)
    expect(
      (
        await putJson(
          `${base}/digest`,
          { ...SETTINGS, siteId: site.id },
          viewer.cookie,
        )
      ).status,
    ).toBe(403)
  })

  it('saves, previews, runs now and removes the digest', async () => {
    const { user, site, base } = await seed()
    const empty = await getJson(`${base}/digest`, user.cookie)
    const emptyBody = await empty.json()
    expect(emptyBody.data.digest).toBeNull()
    expect(emptyBody.data.sites).toEqual([
      { id: site.id, name: 'Site Acme', published: true },
    ])

    const saved = await putJson(
      `${base}/digest`,
      { ...SETTINGS, siteId: site.id },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    const digest = (await saved.json()).data.digest
    expect(digest).toMatchObject({ siteId: site.id, siteName: 'Site Acme' })
    expect(digest.nextRunAt).not.toBeNull()

    const preview = await postJson(
      `${base}/digest/preview`,
      { siteId: site.id, rssUrl: null, maxItems: 5 },
      user.cookie,
    )
    expect(preview.status).toBe(200)
    const items = (await preview.json()).data.items
    expect(items.map((item: { title: string }) => item.title)).toEqual([
      'Post da semana',
    ])

    const run = await postJson(`${base}/digest/run`, {}, user.cookie)
    expect(run.status).toBe(200)
    const result = (await run.json()).data
    expect(result.items).toBe(1)
    const issue = await prisma.crmNewsletterIssue.findUniqueOrThrow({
      where: { id: result.issueId },
    })
    expect(issue).toMatchObject({ status: 'DRAFT', digestId: digest.id })

    expect((await deleteJson(`${base}/digest`, user.cookie)).status).toBe(200)
    expect((await deleteJson(`${base}/digest`, user.cookie)).status).toBe(404)
  })

  it('refuses a site of another workspace and a private feed', async () => {
    const { user, base } = await seed()
    const other = await seed()
    const foreign = await putJson(
      `${base}/digest`,
      { ...SETTINGS, siteId: other.site.id },
      user.cookie,
    )
    expect(foreign.status).toBe(422)
    expect((await foreign.json()).error.code).toBe(
      'CRM_NEWSLETTER_DIGEST_SOURCE_INVALID',
    )
    const privateFeed = await putJson(
      `${base}/digest`,
      { ...SETTINGS, rssUrl: 'https://127.0.0.1/feed' },
      user.cookie,
    )
    expect(privateFeed.status).toBe(422)
    const invalid = await putJson(
      `${base}/digest`,
      { ...SETTINGS, rssUrl: 'http://blog.acme.com.br/feed' },
      user.cookie,
    )
    expect(invalid.status).toBe(422)
  })
})

describe('newsletter AI and A/B test routes', () => {
  it('lists the AI sources (titles only)', async () => {
    const { user, base } = await seed()
    const res = await getJson(`${base}/ai/sources`, user.cookie)
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data.posts.map((post: { title: string }) => post.title)).toEqual([
      'Post da semana',
    ])
    expect(Array.isArray(data.products)).toBe(true)
  })

  it('validates the AI draft brief', async () => {
    const { user, newsletter, base } = await seed()
    const issue = await prisma.crmNewsletterIssue.create({
      data: {
        newsletterId: newsletter.id,
        workspaceId: newsletter.workspaceId,
        createdById: user.id,
        subject: 'Edição',
        slug: 'edicao',
      },
    })
    const res = await postJson(
      `${base}/issues/${issue.id}/ai/draft`,
      { brief: 'curto' },
      user.cookie,
    )
    expect(res.status).toBe(422)
  })

  it('turns the A/B test on, reports it, blocks a small audience and turns it off', async () => {
    const { user, newsletter, base } = await seed(5)
    const issue = await prisma.crmNewsletterIssue.create({
      data: {
        newsletterId: newsletter.id,
        workspaceId: newsletter.workspaceId,
        createdById: user.id,
        subject: 'Assunto A',
        slug: 'assunto-a',
      },
    })
    const url = `${base}/issues/${issue.id}/ab-test`
    const same = await putJson(url, { subjectB: 'Assunto A' }, user.cookie)
    expect(same.status).toBe(422)

    const on = await putJson(
      url,
      {
        subjectB: 'Assunto B',
        testPercent: 30,
        metric: 'CLICKS',
        waitHours: 2,
      },
      user.cookie,
    )
    expect(on.status).toBe(200)
    expect((await on.json()).data).toMatchObject({
      subjectB: 'Assunto B',
      testPercent: 30,
      metric: 'CLICKS',
      winner: null,
    })
    const report = (await (await getJson(url, user.cookie)).json()).data
    expect(report).toMatchObject({
      subjectA: 'Assunto A',
      variants: [],
      held: 0,
    })

    const preflight = await getJson(
      `${base}/issues/${issue.id}/preflight`,
      user.cookie,
    )
    const blockers = (await preflight.json()).data.blockers.map(
      (b: { code: string }) => b.code,
    )
    expect(blockers).toContain('AB_AUDIENCE_TOO_SMALL')

    const detail = await getJson(`${base}/issues/${issue.id}`, user.cookie)
    expect((await detail.json()).data.abTest.subjectB).toBe('Assunto B')

    expect((await deleteJson(url, user.cookie)).status).toBe(200)
    const off = (await (await getJson(url, user.cookie)).json()).data
    expect(off.abTest).toBeNull()
  })
})
