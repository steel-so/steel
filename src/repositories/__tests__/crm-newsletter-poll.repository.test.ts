import { describe, expect, it, vi } from 'vitest'
import {
  seedNewsletterIssue,
  seedNewsletterScope,
  seedNewsletterSubscriber,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import {
  seedIssueRecipient,
  seedPerson,
} from '@/src/__tests__/factories/newsletter2-engage.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmNewsletterPollRepository as Repo } from '../crm-newsletter-poll.repository'

const NOW = new Date('2026-10-28T13:00:00.000Z')
const SNAPSHOT = {
  blockId: 'poll1',
  question: 'Gostou?',
  options: [{ label: 'Sim' }, { label: 'Não' }],
  showResults: true,
}

async function seedVoters(count: number) {
  const scope = await seedNewsletterScope()
  const issue = await seedNewsletterIssue(scope.newsletter, scope.userId, {
    status: 'SENT',
  })
  const person = await seedPerson(scope.workspaceId, scope.userId)
  const recipients = []
  for (let i = 0; i < count; i += 1) {
    const subscriber = await seedNewsletterSubscriber(
      scope.newsletter,
      `v${i}@example.com`,
    )
    if (i === 0) {
      await prisma.crmNewsletterSubscriber.update({
        where: { id: subscriber.id },
        data: { personId: person.id },
      })
    }
    recipients.push(
      await seedIssueRecipient(scope.newsletter, issue.id, subscriber),
    )
  }
  return { ...scope, issue, person, recipients }
}

describe('CrmNewsletterPollRepository', () => {
  it('finds the delivery of a vote link with its issue and person', async () => {
    const { recipients, person, issue, newsletter } = await seedVoters(1)
    const found = expectOk(await Repo.findRecipient(recipients[0].id))
    expect(found).toMatchObject({
      id: recipients[0].id,
      email: 'v0@example.com',
      personId: person.id,
      issue: {
        id: issue.id,
        status: 'SENT',
        deletedAt: null,
        newsletter: { name: newsletter.name },
      },
    })
    expect(expectOk(await Repo.findRecipient('missing'))).toBeNull()
  })

  it('creates the poll once and keeps one vote per delivery', async () => {
    const { workspaceId, issue, recipients, person } = await seedVoters(3)
    const poll = expectOk(
      await Repo.ensurePoll(workspaceId, issue.id, SNAPSHOT),
    )
    const again = expectOk(
      await Repo.ensurePoll(workspaceId, issue.id, {
        ...SNAPSHOT,
        question: 'Outra',
      }),
    )
    expect(again.id).toBe(poll.id)
    expect(again.question).toBe('Gostou?')

    const vote = (index: number, optionIndex: number, at = NOW) =>
      Repo.upsertVote({
        pollId: poll.id,
        recipient: {
          id: recipients[index].id,
          subscriberId: recipients[index].subscriberId,
          email: recipients[index].email,
          personId: index === 0 ? person.id : null,
        },
        optionIndex,
        now: at,
      })
    expect(expectOk(await vote(0, 0))).toEqual({ changed: false })
    expect(expectOk(await vote(0, 0))).toEqual({ changed: false })
    expect(expectOk(await vote(0, 1, new Date(NOW.getTime() + 1000)))).toEqual({
      changed: true,
    })
    expectOk(await vote(1, 1))
    expectOk(await vote(2, 0))

    const counts = expectOk(await Repo.countByOption([poll.id]))
    expect(counts.get(poll.id)?.get(0)).toBe(1)
    expect(counts.get(poll.id)?.get(1)).toBe(2)
    expect(expectOk(await Repo.countByOption([])).size).toBe(0)

    expect(expectOk(await Repo.listPolls(issue.id)).map((p) => p.id)).toEqual([
      poll.id,
    ])
    const all = expectOk(await Repo.listVotes([poll.id]))
    expect(all).toHaveLength(3)
    expect(all[0]).toMatchObject({
      email: 'v0@example.com',
      optionIndex: 1,
      recipientName: 'v0',
    })
    expect(expectOk(await Repo.listVotes([poll.id], 2))).toHaveLength(2)
    expect(expectOk(await Repo.listVotes([]))).toEqual([])

    const names = expectOk(
      await Repo.personNames(workspaceId, [person.id, 'missing']),
    )
    expect([...names]).toEqual([[person.id, 'Ana Lima']])
    expect(expectOk(await Repo.personNames(workspaceId, [])).size).toBe(0)
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const down = () => Promise.reject(new Error('down'))
    const spies = [
      vi
        .spyOn(prisma.crmNewsletterIssueRecipient, 'findUnique')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterPoll, 'upsert')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterPoll, 'findMany')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterPollVote, 'findUnique')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterPollVote, 'groupBy')
        .mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterPollVote, 'findMany')
        .mockImplementation(down as never),
      vi.spyOn(prisma.crmPerson, 'findMany').mockImplementation(down as never),
    ]
    const code = 'DATABASE_ERROR'
    expectErr(await Repo.findRecipient('r'), code)
    expectErr(await Repo.ensurePoll('w', 'i', SNAPSHOT), code)
    expectErr(
      await Repo.upsertVote({
        pollId: 'p',
        recipient: { id: 'r', subscriberId: 's', email: 'e', personId: null },
        optionIndex: 0,
        now: NOW,
      }),
      code,
    )
    expectErr(await Repo.countByOption(['p']), code)
    expectErr(await Repo.listPolls('i'), code)
    expectErr(await Repo.listVotes(['p']), code)
    expectErr(await Repo.personNames('w', ['p']), code)
    for (const spy of spies) spy.mockRestore()
  })
})
