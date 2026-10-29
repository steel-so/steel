import type { CrmNewsletterPoll } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import {
  crmNewsletterPollNotFound,
  crmNewsletterTokenInvalid,
} from '@/src/errors'
import { csvDocument } from '@/src/lib/csv-writer'
import {
  extractPolls,
  newsletterPollUrl,
  type PollBlock,
  type PollLinkBuilder,
} from '@/src/lib/newsletter/poll-links'
import {
  createPollVoteToken,
  verifyPollVoteToken,
} from '@/src/lib/newsletter/poll-token'
import { err, ok, type Result } from '@/src/lib/result'
import {
  CrmNewsletterPollRepository,
  type PollVoteRow,
} from '@/src/repositories/crm-newsletter-poll.repository'
import {
  CRM_NEWSLETTER_POLL_VOTERS_LIMIT,
  type CrmNewsletterIssuePollsDTO,
  type CrmNewsletterPollOptionDTO,
  type CrmNewsletterPollReportDTO,
  type CrmNewsletterPollVoteResultDTO,
} from '@/src/schemas/crm-newsletter-engage.schema'
import { loadIssue, loadNewsletterScope } from './crm-newsletter-issue.service'
import { validateIssueDocument } from './crm-newsletter-render'

/**
 * Polls of newsletter issues (slice nl2-engage): the signed vote link of
 * each option (built per delivery by the send), the public vote, and the
 * results in the issue report (bars, voters, CSV).
 */

/** Issues whose vote links are live (the e-mail went out). */
const VOTABLE_STATUSES = new Set(['SENDING', 'SENT', 'CANCELED'])

/** Vote links of one delivery, for `personalizeIssue`. */
export function pollVoteLinkFor(recipientId: string): PollLinkBuilder {
  return (blockId, optionIndex) =>
    newsletterPollUrl(
      BETTER_AUTH_URL,
      createPollVoteToken({ recipientId, blockId, optionIndex }),
    )
}

/** Poll blocks of a stored issue document (empty when it is invalid). */
export function pollsOfDocument(builderDocument: unknown): PollBlock[] {
  const doc = validateIssueDocument(builderDocument)
  return doc.ok ? extractPolls(doc.value) : []
}

function optionLabels(poll: CrmNewsletterPoll): string[] {
  const options = Array.isArray(poll.options) ? poll.options : []
  return options.map((option) =>
    typeof option === 'object' && option !== null && 'label' in option
      ? String((option as { label: unknown }).label)
      : '',
  )
}

function optionStats(
  labels: string[],
  counts: Map<number, number> | undefined,
): { totalVotes: number; options: CrmNewsletterPollOptionDTO[] } {
  const options = labels.map((label, index) => ({
    index,
    label,
    votes: counts?.get(index) ?? 0,
  }))
  return {
    totalVotes: options.reduce((sum, option) => sum + option.votes, 0),
    options,
  }
}

const spDateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'short',
})

type IssueScopeArgs = [
  actorId: string,
  workspaceId: string,
  newsletterId: string,
  issueId: string,
]

/** Polls of the report: the blocks of the document (in order), each with
 * the stored poll when someone voted. */
async function loadIssuePolls(
  ...[actorId, workspaceId, newsletterId, issueId]: IssueScopeArgs
) {
  const scope = await loadNewsletterScope(
    actorId,
    workspaceId,
    newsletterId,
    'VIEW',
  )
  if (!scope.ok) return scope
  const issue = await loadIssue(workspaceId, newsletterId, issueId)
  if (!issue.ok) return issue
  const stored = await CrmNewsletterPollRepository.listPolls(issueId)
  if (!stored.ok) return stored
  const byBlock = new Map(stored.value.map((poll) => [poll.blockId, poll]))
  const blocks = pollsOfDocument(issue.value.builderDocument)
  const seen = new Set(blocks.map((block) => block.blockId))
  // A poll voted on but no longer in the document still reports (the
  // document is locked once sent, so this is only defensive).
  for (const poll of stored.value) {
    if (!seen.has(poll.blockId)) {
      blocks.push({
        blockId: poll.blockId,
        question: poll.question,
        options: optionLabels(poll),
        showResults: poll.showResults,
      })
    }
  }
  return ok({
    newsletter: scope.value.newsletter,
    issue: issue.value,
    polls: blocks.map((block) => ({
      block,
      stored: byBlock.get(block.blockId) ?? null,
    })),
  })
}

export const CrmNewsletterPollService = {
  /**
   * Public vote (no session): the signed link names the delivery, the poll
   * block and the option. One vote per delivery and poll; a second click
   * swaps the option.
   */
  async vote(
    token: string,
    now: Date,
  ): Promise<Result<CrmNewsletterPollVoteResultDTO>> {
    const payload = verifyPollVoteToken(token)
    if (!payload.ok) return err(crmNewsletterTokenInvalid())
    const { recipientId, blockId, optionIndex } = payload.value

    const recipient =
      await CrmNewsletterPollRepository.findRecipient(recipientId)
    if (!recipient.ok) return recipient
    const issue = recipient.value?.issue
    if (
      !recipient.value ||
      !issue ||
      issue.deletedAt ||
      !VOTABLE_STATUSES.has(issue.status)
    ) {
      return err(crmNewsletterPollNotFound())
    }
    const block = pollsOfDocument(issue.builderDocument).find(
      (poll) => poll.blockId === blockId,
    )
    if (!block || optionIndex >= block.options.length) {
      return err(crmNewsletterPollNotFound())
    }

    const poll = await CrmNewsletterPollRepository.ensurePoll(
      issue.workspaceId,
      issue.id,
      {
        blockId,
        question: block.question,
        options: block.options.map((label) => ({ label })),
        showResults: block.showResults,
      },
    )
    if (!poll.ok) return poll
    const voted = await CrmNewsletterPollRepository.upsertVote({
      pollId: poll.value.id,
      recipient: recipient.value,
      optionIndex,
      now,
    })
    if (!voted.ok) return voted
    logger.info('crm.newsletter.poll_voted', {
      component: 'CrmNewsletterPollService',
      workspaceId: issue.workspaceId,
      issueId: issue.id,
      pollId: poll.value.id,
      changed: voted.value.changed,
    })

    const labels = optionLabels(poll.value)
    let results: CrmNewsletterPollVoteResultDTO['results'] = null
    if (poll.value.showResults) {
      const counts = await CrmNewsletterPollRepository.countByOption([
        poll.value.id,
      ])
      if (!counts.ok) return counts
      results = optionStats(labels, counts.value.get(poll.value.id))
    }
    return ok({
      newsletterName: issue.newsletter.name,
      question: poll.value.question,
      chosenIndex: optionIndex,
      chosenLabel: labels[optionIndex] ?? block.options[optionIndex] ?? '',
      changed: voted.value.changed,
      results,
    })
  },

  /** Results of every poll of the issue, with the latest voters. */
  async report(
    ...args: IssueScopeArgs
  ): Promise<Result<CrmNewsletterIssuePollsDTO>> {
    const loaded = await loadIssuePolls(...args)
    if (!loaded.ok) return loaded
    const pollIds = loaded.value.polls
      .map((entry) => entry.stored?.id)
      .filter((id): id is string => Boolean(id))
    const [counts, votes] = await Promise.all([
      CrmNewsletterPollRepository.countByOption(pollIds),
      CrmNewsletterPollRepository.listVotes(
        pollIds,
        CRM_NEWSLETTER_POLL_VOTERS_LIMIT + 1,
      ),
    ])
    if (!counts.ok) return counts
    if (!votes.ok) return votes
    const names = await CrmNewsletterPollRepository.personNames(
      loaded.value.issue.workspaceId,
      [
        ...new Set(
          votes.value
            .map((vote) => vote.personId)
            .filter((id): id is string => Boolean(id)),
        ),
      ],
    )
    if (!names.ok) return names

    const votesByPoll = new Map<string, PollVoteRow[]>()
    for (const vote of votes.value) {
      votesByPoll.set(vote.pollId, [
        ...(votesByPoll.get(vote.pollId) ?? []),
        vote,
      ])
    }
    const polls = loaded.value.polls.map(
      ({ block, stored }): CrmNewsletterPollReportDTO => {
        const labels = stored ? optionLabels(stored) : block.options
        const stats = optionStats(
          labels,
          stored ? counts.value.get(stored.id) : undefined,
        )
        const pollVotes = stored ? (votesByPoll.get(stored.id) ?? []) : []
        return {
          blockId: block.blockId,
          question: stored?.question ?? block.question,
          showResults: stored?.showResults ?? block.showResults,
          ...stats,
          voters: pollVotes
            .slice(0, CRM_NEWSLETTER_POLL_VOTERS_LIMIT)
            .map((vote) => {
              const personName = vote.personId
                ? names.value.get(vote.personId)
                : undefined
              return {
                id: vote.id,
                name: personName ?? vote.recipientName,
                email: vote.email,
                personId: personName !== undefined ? vote.personId : null,
                optionIndex: vote.optionIndex,
                votedAt: vote.votedAt.toISOString(),
              }
            }),
          votersTruncated: pollVotes.length > CRM_NEWSLETTER_POLL_VOTERS_LIMIT,
        }
      },
    )
    return ok({ polls })
  },

  /** Every vote of the issue as CSV (audited: it carries e-mails). */
  async exportCsv(
    ...args: IssueScopeArgs
  ): Promise<Result<{ filename: string; csv: string }>> {
    const loaded = await loadIssuePolls(...args)
    if (!loaded.ok) return loaded
    const stored = loaded.value.polls.filter((entry) => entry.stored)
    const votes = await CrmNewsletterPollRepository.listVotes(
      stored.map((entry) => entry.stored?.id as string),
    )
    if (!votes.ok) return votes
    const names = await CrmNewsletterPollRepository.personNames(
      loaded.value.issue.workspaceId,
      [
        ...new Set(
          votes.value
            .map((vote) => vote.personId)
            .filter((id): id is string => Boolean(id)),
        ),
      ],
    )
    if (!names.ok) return names

    const polls = new Map(
      stored.map((entry) => [
        entry.stored?.id as string,
        {
          question: entry.stored?.question ?? '',
          labels: optionLabels(entry.stored as CrmNewsletterPoll),
        },
      ]),
    )
    const csv = csvDocument(
      [
        'Pergunta',
        'Opção',
        'E-mail',
        'Nome',
        'Pessoa no CRM',
        'Votou em (São Paulo)',
      ],
      votes.value.map((vote) => {
        const poll = polls.get(vote.pollId)
        const personName = vote.personId
          ? names.value.get(vote.personId)
          : undefined
        return [
          poll?.question ?? '',
          poll?.labels[vote.optionIndex] ?? '',
          vote.email,
          personName ?? vote.recipientName ?? '',
          personName ? 'Sim' : 'Não',
          spDateTime.format(vote.votedAt).replace(',', ''),
        ]
      }),
    )
    const [actorId, workspaceId, newsletterId, issueId] = args
    auditMutation({
      entity: 'crm_newsletter_poll',
      action: 'export_completed',
      actorId,
      targetId: issueId,
      meta: { workspaceId, newsletterId, rows: votes.value.length },
    })
    const number = loaded.value.issue.number
    return ok({
      filename: `enquete-${loaded.value.newsletter.slug}-${number ?? loaded.value.issue.slug}.csv`,
      csv,
    })
  },
}
