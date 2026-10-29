import { describe, expect, it } from 'vitest'
import { pollIssueDocument } from '@/src/__tests__/factories/newsletter2-engage.factory'
import { authenticatedOwner, postJson } from '@/src/__tests__/helpers/e2e'
import { createPollVoteToken } from '@/src/lib/newsletter/poll-token'
import { prisma } from '@/src/lib/prisma'

/** A sent issue with the poll block `poll1` and one delivery. */
async function seedDelivery() {
  const { user, workspace } = await authenticatedOwner()
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
  const subscriber = await prisma.crmNewsletterSubscriber.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: workspace.id,
      email: 'leitor@example.com',
      status: 'ACTIVE',
      source: 'MANUAL',
    },
  })
  const issue = await prisma.crmNewsletterIssue.create({
    data: {
      newsletterId: newsletter.id,
      workspaceId: workspace.id,
      createdById: user.id,
      subject: 'Outubro',
      slug: 'outubro',
      status: 'SENT',
      builderDocument: pollIssueDocument() as never,
    },
  })
  const recipient = await prisma.crmNewsletterIssueRecipient.create({
    data: {
      issueId: issue.id,
      workspaceId: workspace.id,
      subscriberId: subscriber.id,
      email: subscriber.email,
      status: 'SENT',
    },
  })
  return { issue, recipient }
}

describe('POST /api/newsletters/polls/[token]', () => {
  it('refuses forged tokens and unknown polls without a session', async () => {
    const forged = await postJson('/api/newsletters/polls/abc.def', {})
    expect(forged.status).toBe(404)
    const unknown = await postJson(
      `/api/newsletters/polls/${createPollVoteToken({ recipientId: 'nope', blockId: 'poll1', optionIndex: 0 })}`,
      {},
    )
    expect(unknown.status).toBe(404)
  })

  it('records one vote per delivery; voting again swaps the option', async () => {
    const { recipient } = await seedDelivery()
    const link = (optionIndex: number) =>
      `/api/newsletters/polls/${createPollVoteToken({ recipientId: recipient.id, blockId: 'poll1', optionIndex })}`

    const first = await postJson(link(0), {})
    expect(first.status).toBe(200)
    expect((await first.json()).data).toMatchObject({
      question: 'Gostou?',
      chosenLabel: 'Sim',
      changed: false,
      results: { totalVotes: 1 },
    })

    const second = await postJson(link(2), {})
    expect(second.status).toBe(200)
    expect((await second.json()).data).toMatchObject({
      chosenLabel: 'Talvez',
      changed: true,
      results: { totalVotes: 1 },
    })
    expect(
      await prisma.crmNewsletterPollVote.count({
        where: { recipientId: recipient.id },
      }),
    ).toBe(1)

    expect((await postJson(link(7), {})).status).toBe(404)
  })
})
