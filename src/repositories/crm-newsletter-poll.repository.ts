import type {
  CrmNewsletterIssueStatus,
  CrmNewsletterPoll,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Polls of newsletter issues and their votes (slice nl2-engage). A poll row
 * is created on the first vote with a snapshot of the block; each delivery
 * (issue recipient) holds at most one vote per poll — voting again only
 * swaps the option.
 */

export type VoteRecipient = {
  id: string
  subscriberId: string
  email: string
  name: string | null
  personId: string | null
  issue: {
    id: string
    workspaceId: string
    status: CrmNewsletterIssueStatus
    builderDocument: Prisma.JsonValue
    deletedAt: Date | null
    newsletter: { name: string }
  }
}

export type PollSnapshot = {
  blockId: string
  question: string
  options: { label: string }[]
  showResults: boolean
}

export type PollVoteRow = {
  id: string
  pollId: string
  email: string
  personId: string | null
  optionIndex: number
  votedAt: Date
  recipientName: string | null
}

export const CrmNewsletterPollRepository = {
  /** Delivery of a vote link, with what the vote needs from its issue. */
  async findRecipient(
    recipientId: string,
  ): Promise<Result<VoteRecipient | null>> {
    try {
      const row = await prisma.crmNewsletterIssueRecipient.findUnique({
        where: { id: recipientId },
        select: {
          id: true,
          subscriberId: true,
          email: true,
          name: true,
          subscriber: { select: { personId: true } },
          issue: {
            select: {
              id: true,
              workspaceId: true,
              status: true,
              builderDocument: true,
              deletedAt: true,
              newsletter: { select: { name: true } },
            },
          },
        },
      })
      if (!row) return ok(null)
      const { subscriber, ...rest } = row
      return ok({ ...rest, personId: subscriber.personId })
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter poll recipient', error))
    }
  },

  /** The poll of a block, created from the snapshot when missing. */
  async ensurePoll(
    workspaceId: string,
    issueId: string,
    snapshot: PollSnapshot,
  ): Promise<Result<CrmNewsletterPoll>> {
    try {
      const poll = await prisma.crmNewsletterPoll.upsert({
        where: { issueId_blockId: { issueId, blockId: snapshot.blockId } },
        create: {
          workspaceId,
          issueId,
          blockId: snapshot.blockId,
          question: snapshot.question,
          options: snapshot.options,
          showResults: snapshot.showResults,
        },
        update: {},
      })
      return ok(poll)
    } catch (error) {
      return err(dbError('Failed to ensure CRM newsletter poll', error))
    }
  },

  /**
   * Records the vote of a delivery (one per poll). `changed` is true when
   * an earlier vote for another option was replaced.
   */
  async upsertVote(input: {
    pollId: string
    recipient: Pick<VoteRecipient, 'id' | 'subscriberId' | 'email' | 'personId'>
    optionIndex: number
    now: Date
  }): Promise<Result<{ changed: boolean }>> {
    try {
      const where = {
        pollId_recipientId: {
          pollId: input.pollId,
          recipientId: input.recipient.id,
        },
      }
      const previous = await prisma.crmNewsletterPollVote.findUnique({
        where,
        select: { optionIndex: true },
      })
      await prisma.crmNewsletterPollVote.upsert({
        where,
        create: {
          pollId: input.pollId,
          recipientId: input.recipient.id,
          subscriberId: input.recipient.subscriberId,
          email: input.recipient.email,
          personId: input.recipient.personId,
          optionIndex: input.optionIndex,
          votedAt: input.now,
        },
        update: { optionIndex: input.optionIndex, votedAt: input.now },
      })
      return ok({
        changed:
          previous !== null && previous.optionIndex !== input.optionIndex,
      })
    } catch (error) {
      return err(dbError('Failed to record CRM newsletter poll vote', error))
    }
  },

  /** Votes per option index, per poll. */
  async countByOption(
    pollIds: string[],
  ): Promise<Result<Map<string, Map<number, number>>>> {
    const counts = new Map<string, Map<number, number>>()
    if (pollIds.length === 0) return ok(counts)
    try {
      const rows = await prisma.crmNewsletterPollVote.groupBy({
        by: ['pollId', 'optionIndex'],
        where: { pollId: { in: pollIds } },
        _count: { _all: true },
      })
      for (const row of rows) {
        const poll = counts.get(row.pollId) ?? new Map<number, number>()
        poll.set(row.optionIndex, row._count._all)
        counts.set(row.pollId, poll)
      }
      return ok(counts)
    } catch (error) {
      return err(dbError('Failed to count CRM newsletter poll votes', error))
    }
  },

  async listPolls(issueId: string): Promise<Result<CrmNewsletterPoll[]>> {
    try {
      return ok(
        await prisma.crmNewsletterPoll.findMany({
          where: { issueId },
          orderBy: { createdAt: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list CRM newsletter polls', error))
    }
  },

  /** Most recent votes first; `limit` per poll (omit for every vote). */
  async listVotes(
    pollIds: string[],
    limit?: number,
  ): Promise<Result<PollVoteRow[]>> {
    if (pollIds.length === 0) return ok([])
    try {
      const batches = await Promise.all(
        (limit === undefined ? [pollIds] : pollIds.map((id) => [id])).map(
          (ids) =>
            prisma.crmNewsletterPollVote.findMany({
              where: { pollId: { in: ids } },
              orderBy: [{ votedAt: 'desc' }, { id: 'asc' }],
              ...(limit === undefined ? {} : { take: limit }),
              select: {
                id: true,
                pollId: true,
                email: true,
                personId: true,
                optionIndex: true,
                votedAt: true,
                recipient: { select: { name: true } },
              },
            }),
        ),
      )
      return ok(
        batches.flat().map(({ recipient, ...vote }) => ({
          ...vote,
          recipientName: recipient.name,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list CRM newsletter poll votes', error))
    }
  },

  /** Names of the CRM people linked to voters (by id). */
  async personNames(
    workspaceId: string,
    personIds: string[],
  ): Promise<Result<Map<string, string>>> {
    if (personIds.length === 0) return ok(new Map())
    try {
      const people = await prisma.crmPerson.findMany({
        where: { workspaceId, id: { in: personIds }, deletedAt: null },
        select: { id: true, name: true },
      })
      return ok(new Map(people.map((person) => [person.id, person.name])))
    } catch (error) {
      return err(dbError('Failed to read CRM people of poll voters', error))
    }
  },
}
