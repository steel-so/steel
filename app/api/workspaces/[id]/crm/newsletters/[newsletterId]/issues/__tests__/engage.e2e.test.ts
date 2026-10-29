import { describe, expect, it } from 'vitest'
import { pollIssueDocument } from '@/src/__tests__/factories/newsletter2-engage.factory'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  defaultHeaders,
  getJson,
  patchJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

/** Newsletter + a sent issue with a poll (two votes) and a Z-API connection. */
async function seed(status: 'DRAFT' | 'SENT' = 'SENT') {
  const { user, workspace } = await authenticatedOwner()
  const { cookie } = user
  const newsletter = await prisma.crmNewsletter.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      name: 'Novidades',
      slug: 'novidades',
      fromName: 'Acme',
      fromEmail: 'news@acme-e2e.com.br',
    },
  })
  const issue = await prisma.crmNewsletterIssue.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: workspace.id,
      createdById: user.id,
      subject: 'Outubro',
      slug: 'outubro',
      status,
      number: status === 'SENT' ? 1 : null,
      builderDocument: pollIssueDocument() as never,
    },
  })
  const poll = await prisma.crmNewsletterPoll.create({
    data: {
      workspaceId: workspace.id,
      issueId: issue.id,
      blockId: 'poll1',
      question: 'Gostou?',
      options: [{ label: 'Sim' }, { label: 'Não' }, { label: 'Talvez' }],
    },
  })
  for (const [index, email] of ['a@example.com', 'b@example.com'].entries()) {
    const subscriber = await prisma.crmNewsletterSubscriber.create({
      data: {
        newsletterId: newsletter.id,
        workspaceId: workspace.id,
        email,
        status: 'ACTIVE',
        source: 'MANUAL',
      },
    })
    const recipient = await prisma.crmNewsletterIssueRecipient.create({
      data: {
        issueId: issue.id,
        workspaceId: workspace.id,
        subscriberId: subscriber.id,
        email,
        status: 'SENT',
      },
    })
    await prisma.crmNewsletterPollVote.create({
      data: {
        pollId: poll.id,
        recipientId: recipient.id,
        subscriberId: subscriber.id,
        email,
        optionIndex: index,
        votedAt: new Date(),
      },
    })
  }
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'ZAPI',
      label: 'Suporte',
      phoneNumber: '5511999999999',
      zapiInstanceId: `nl2-engage-${workspace.id}`,
      encryptedZapiToken: 'enc:token',
      status: 'CONNECTED',
      createdById: user.id,
    },
  })
  const base = `/api/workspaces/${workspace.id}/crm/newsletters/${newsletter.id}/issues/${issue.id}`
  return { workspace, cookie, base, connection }
}

describe('newsletter issue polls and WhatsApp (nl2-engage)', () => {
  it('returns 401 without a session', async () => {
    for (const path of [
      'polls',
      'polls/export',
      'whatsapp',
      'whatsapp/recipients',
    ]) {
      const res = await fetch(
        `${BASE_URL}/api/workspaces/x/crm/newsletters/y/issues/z/${path}`,
        { headers: defaultHeaders },
      )
      expect(res.status, path).toBe(401)
    }
  })

  it('reports poll results and exports the votes as CSV', async () => {
    const { cookie, base, workspace } = await seed()
    const res = await getJson(`${base}/polls`, cookie)
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.polls[0]).toMatchObject({
      blockId: 'poll1',
      totalVotes: 2,
      options: [
        { label: 'Sim', votes: 1 },
        { label: 'Não', votes: 1 },
        { label: 'Talvez', votes: 0 },
      ],
    })
    expect(data.polls[0].voters).toHaveLength(2)

    const csv = await getJson(`${base}/polls/export`, cookie)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(csv.headers.get('content-disposition')).toContain(
      'enquete-novidades-1.csv',
    )
    expect(await csv.text()).toContain('a@example.com')

    const stranger = await createAuthenticatedUser()
    expect((await getJson(`${base}/polls`, stranger.cookie)).status).toBe(403)
    const viewer = await addMember(workspace.id, 'VIEWER')
    expect((await getJson(`${base}/polls`, viewer.cookie)).status).toBe(200)
  })

  it('reads and saves the WhatsApp version of a draft', async () => {
    const { cookie, base, connection, workspace } = await seed('DRAFT')
    const initial = await getJson(`${base}/whatsapp`, cookie)
    expect(initial.status).toBe(200)
    expect((await initial.json()).data).toMatchObject({
      enabled: false,
      available: true,
      reach: { linked: 0, reachable: 0 },
    })

    const invalid = await patchJson(`${base}/whatsapp`, { text: 1 }, cookie)
    expect(invalid.status).toBe(422)
    const foreign = await patchJson(
      `${base}/whatsapp`,
      { connectionId: 'nope' },
      cookie,
    )
    expect(foreign.status).toBe(422)

    const saved = await patchJson(
      `${base}/whatsapp`,
      {
        enabled: true,
        connectionId: connection.id,
        text: 'Leia {link}',
        legalBasis: 'CONSENT',
        confirmLegalBasis: true,
      },
      cookie,
    )
    expect(saved.status).toBe(200)
    const dto = (await saved.json()).data
    expect(dto).toMatchObject({ enabled: true, connectionId: connection.id })
    expect(dto.consentConfirmedAt).not.toBeNull()

    const viewer = await addMember(workspace.id, 'VIEWER')
    expect(
      (await patchJson(`${base}/whatsapp`, { enabled: false }, viewer.cookie))
        .status,
    ).toBe(403)

    const report = await getJson(
      `${base}/whatsapp/recipients?page=1&status=SENT`,
      cookie,
    )
    expect(report.status).toBe(200)
    expect((await report.json()).data).toMatchObject({
      enabled: true,
      provider: 'ZAPI',
      stats: { total: 0, delivered: 0, read: 0 },
    })
    expect(
      (await getJson(`${base}/whatsapp/recipients?status=NOPE`, cookie)).status,
    ).toBe(422)
  })

  it('locks the WhatsApp version once the issue went out', async () => {
    const { cookie, base } = await seed('SENT')
    const res = await patchJson(`${base}/whatsapp`, { enabled: true }, cookie)
    expect(res.status).toBe(409)
  })
})
