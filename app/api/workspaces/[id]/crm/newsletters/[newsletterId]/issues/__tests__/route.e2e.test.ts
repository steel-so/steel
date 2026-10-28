import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

/** Workspace + newsletter (+ optionally a VERIFIED sending domain). */
async function seed(
  options: { verified?: boolean; subscribers?: string[] } = {},
) {
  const { user, workspace } = await authenticatedOwner()
  const domain = `news-${workspace.id.slice(-6)}.acme-e2e.com.br`
  if (options.verified) {
    await prisma.workspaceSendingDomain.create({
      data: {
        workspaceId: workspace.id,
        name: domain,
        status: 'VERIFIED',
        createdById: user.id,
      },
    })
  }
  const newsletter = await prisma.crmNewsletter.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: 'Novidades',
      slug: 'novidades',
      fromName: 'Acme',
      fromEmail: `news@${domain}`,
    },
  })
  for (const email of options.subscribers ?? []) {
    await prisma.crmNewsletterSubscriber.create({
      data: {
        newsletterId: newsletter.id,
        workspaceId: workspace.id,
        email,
        status: 'ACTIVE',
        source: 'MANUAL',
      },
    })
  }
  const base = `/api/workspaces/${workspace.id}/crm/newsletters/${newsletter.id}/issues`
  return { user, workspace, newsletter, base }
}

function newsletterIdOf(base: string): string {
  return base.split('/newsletters/')[1].split('/')[0]
}

describe('/api/workspaces/[id]/crm/newsletters/[newsletterId]/issues', () => {
  it('returns 401 without a session', async () => {
    const res = await fetch(
      `${BASE_URL}/api/workspaces/x/crm/newsletters/y/issues`,
      { headers: defaultHeaders },
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 to non-members and VIEWERs writing, 404 for another workspace', async () => {
    const { workspace, base } = await seed()
    const stranger = await createAuthenticatedUser()
    expect((await getJson(base, stranger.cookie)).status).toBe(403)
    const viewer = await addMember(workspace.id, 'VIEWER')
    expect((await getJson(base, viewer.cookie)).status).toBe(200)
    expect(
      (await postJson(base, { subject: 'Oi' }, viewer.cookie)).status,
    ).toBe(403)

    // A newsletter of another workspace is not found under this one.
    const other = await seed()
    const res = await getJson(
      `/api/workspaces/${other.workspace.id}/crm/newsletters/${newsletterIdOf(base)}/issues`,
      other.user.cookie,
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('CRM_NEWSLETTER_NOT_FOUND')
  })

  it('creates, edits, lists, test-sends and deletes a draft', async () => {
    const { user, base } = await seed()
    const created = await postJson(
      base,
      { subject: 'Novidades de outubro' },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const issue = (await created.json()).data
    expect(issue).toMatchObject({
      status: 'DRAFT',
      slug: 'novidades-de-outubro',
      number: null,
    })
    expect(issue.builderDocument).toBeTruthy()

    const invalid = await postJson(base, { subject: '' }, user.cookie)
    expect(invalid.status).toBe(422)

    const patched = await patchJson(
      `${base}/${issue.id}`,
      { subject: 'Outubro', slug: 'outubro' },
      user.cookie,
    )
    expect(patched.status).toBe(200)
    expect((await patched.json()).data).toMatchObject({
      subject: 'Outubro',
      slug: 'outubro',
    })

    const list = (await (await getJson(base, user.cookie)).json()).data
    expect(list.total).toBe(1)
    expect(list.items[0]).not.toHaveProperty('builderDocument')

    const detail = await getJson(`${base}/${issue.id}`, user.cookie)
    expect((await detail.json()).data.builderDocument).toBeTruthy()

    // Test sends go to dry-run addresses on the e2e server.
    const test = await postJson(
      `${base}/${issue.id}/test`,
      { emails: ['qa@example.com'] },
      user.cookie,
    )
    expect(test.status).toBe(200)
    expect(
      (
        await postJson(
          `${base}/${issue.id}/test`,
          { emails: Array.from({ length: 6 }, (_, i) => `q${i}@example.com`) },
          user.cookie,
        )
      ).status,
    ).toBe(422)

    const report = await getJson(`${base}/${issue.id}/report`, user.cookie)
    expect((await report.json()).data.stats.sent).toBe(0)
    const recipients = await getJson(
      `${base}/${issue.id}/recipients?filter=opened`,
      user.cookie,
    )
    expect((await recipients.json()).data.total).toBe(0)
    expect(
      (await getJson(`${base}/${issue.id}/recipients?filter=nope`, user.cookie))
        .status,
    ).toBe(422)
    expect((await getJson(`${base}/trend`, user.cookie)).status).toBe(200)

    const removed = await deleteJson(`${base}/${issue.id}`, user.cookie)
    expect(removed.status).toBe(200)
    expect((await getJson(`${base}/${issue.id}`, user.cookie)).status).toBe(404)
  })

  it('blocks sending while the sender domain is not verified', async () => {
    const { user, base } = await seed({ subscribers: ['a@example.com'] })
    const issue = (
      await (await postJson(base, { subject: 'Oi' }, user.cookie)).json()
    ).data
    const preflight = (
      await (await getJson(`${base}/${issue.id}/preflight`, user.cookie)).json()
    ).data
    expect(preflight.senderVerified).toBe(false)
    expect(preflight.blockers.map((b: { code: string }) => b.code)).toContain(
      'SENDER_NOT_VERIFIED',
    )
    const res = await postJson(`${base}/${issue.id}/send`, {}, user.cookie)
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('SENDING_DOMAIN_NOT_VERIFIED')
  })

  it('refuses a send without subscribers and above the monthly quota', async () => {
    const empty = await seed({ verified: true })
    const draft = (
      await (
        await postJson(empty.base, { subject: 'Oi' }, empty.user.cookie)
      ).json()
    ).data
    const none = await postJson(
      `${empty.base}/${draft.id}/send`,
      {},
      empty.user.cookie,
    )
    expect((await none.json()).error.code).toBe('CRM_NEWSLETTER_NO_SUBSCRIBERS')

    const full = await seed({
      verified: true,
      subscribers: ['a@example.com', 'b@example.com'],
    })
    await prisma.crmNewsletterSettings.create({
      data: { workspaceId: full.workspace.id, monthlyEmailLimitOverride: 1 },
    })
    const issue = (
      await (
        await postJson(full.base, { subject: 'Oi' }, full.user.cookie)
      ).json()
    ).data
    const limited = await postJson(
      `${full.base}/${issue.id}/send`,
      {},
      full.user.cookie,
    )
    expect(limited.status).toBe(402)
    expect((await limited.json()).error.code).toBe(
      'CRM_NEWSLETTER_LIMIT_REACHED',
    )
  })

  it('schedules, cancels, sends and locks the issue', async () => {
    const { user, base } = await seed({
      verified: true,
      subscribers: ['a@example.com', 'b@example.com'],
    })
    const issue = (
      await (
        await postJson(base, { subject: 'Oi {{primeiro_nome}}' }, user.cookie)
      ).json()
    ).data

    const early = await postJson(
      `${base}/${issue.id}/send`,
      { scheduledAt: new Date(Date.now() + 60_000).toISOString() },
      user.cookie,
    )
    expect(early.status).toBe(422)

    const scheduled = await postJson(
      `${base}/${issue.id}/send`,
      { scheduledAt: new Date(Date.now() + 60 * 60_000).toISOString() },
      user.cookie,
    )
    expect(scheduled.status).toBe(200)
    expect((await scheduled.json()).data.status).toBe('SCHEDULED')

    const canceled = await postJson(
      `${base}/${issue.id}/cancel`,
      {},
      user.cookie,
    )
    expect((await canceled.json()).data.status).toBe('DRAFT')

    const sent = await postJson(`${base}/${issue.id}/send`, {}, user.cookie)
    expect(sent.status).toBe(200)
    const sending = (await sent.json()).data
    expect(sending).toMatchObject({ status: 'SENDING', number: 1 })
    expect(
      await prisma.crmNewsletterIssueRecipient.count({
        where: { issueId: issue.id },
      }),
    ).toBe(2)

    const locked = await patchJson(
      `${base}/${issue.id}`,
      { subject: 'x' },
      user.cookie,
    )
    expect(locked.status).toBe(409)
    expect((await locked.json()).error.code).toBe('CRM_NEWSLETTER_ISSUE_LOCKED')
    expect((await deleteJson(`${base}/${issue.id}`, user.cookie)).status).toBe(
      409,
    )

    const stopped = await postJson(`${base}/${issue.id}/stop`, {}, user.cookie)
    expect(stopped.status).toBe(200)
    expect(['SENT', 'CANCELED']).toContain((await stopped.json()).data.status)
  })
})

describe('/api/workspaces/[id]/crm/newsletter-usage', () => {
  it('shows the month usage to members', async () => {
    const { user, workspace } = await authenticatedOwner()
    const res = await getJson(
      `/api/workspaces/${workspace.id}/crm/newsletter-usage`,
      user.cookie,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({
      emailsSent: 0,
      limit: 3000,
      limitSource: 'PLAN',
    })
    const stranger = await createAuthenticatedUser()
    expect(
      (
        await getJson(
          `/api/workspaces/${workspace.id}/crm/newsletter-usage`,
          stranger.cookie,
        )
      ).status,
    ).toBe(403)
  })
})
