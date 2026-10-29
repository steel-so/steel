import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeNewsletter,
  createFakeNewsletterIssue,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import {
  createFakePoll,
  pollIssueDocument,
} from '@/src/__tests__/factories/newsletter2-engage.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmNewsletterIssueNotFound,
  databaseError,
  forbidden,
} from '@/src/errors'
import {
  createPollVoteToken,
  verifyPollVoteToken,
} from '@/src/lib/newsletter/poll-token'
import { err, ok } from '@/src/lib/result'
import type {
  PollVoteRow,
  VoteRecipient,
} from '@/src/repositories/crm-newsletter-poll.repository'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/repositories/crm-newsletter-poll.repository')
vi.mock('@/src/services/crm-newsletter-issue.service', () => ({
  loadNewsletterScope: vi.fn(),
  loadIssue: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { CrmNewsletterPollRepository } from '@/src/repositories/crm-newsletter-poll.repository'
import { loadIssue, loadNewsletterScope } from '../crm-newsletter-issue.service'
import {
  pollsOfDocument,
  pollVoteLinkFor,
  CrmNewsletterPollService as Service,
} from '../crm-newsletter-poll.service'

const repo = vi.mocked(CrmNewsletterPollRepository)
const NOW = new Date('2026-10-28T13:00:00.000Z')
const A = ['u1', 'ws1', 'nl1', 'is1'] as const

function recipient(over: Partial<VoteRecipient['issue']> = {}): VoteRecipient {
  return {
    id: 'r1',
    subscriberId: 's1',
    email: 'ana@example.com',
    name: 'Ana',
    personId: 'p1',
    issue: {
      id: 'is1',
      workspaceId: 'ws1',
      status: 'SENT',
      builderDocument: pollIssueDocument(),
      deletedAt: null,
      newsletter: { name: 'Novidades Acme' },
      ...over,
    },
  }
}

const token = (optionIndex = 1, blockId = 'poll1') =>
  createPollVoteToken({ recipientId: 'r1', blockId, optionIndex })

function vote(over: Partial<PollVoteRow> = {}): PollVoteRow {
  return {
    id: 'v1',
    pollId: 'pl1',
    email: 'ana@example.com',
    personId: 'p1',
    optionIndex: 0,
    votedAt: NOW,
    recipientName: 'Ana',
    ...over,
  }
}

describe('CrmNewsletterPollService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repo.findRecipient.mockResolvedValue(ok(recipient()))
    repo.ensurePoll.mockResolvedValue(ok(createFakePoll()))
    repo.upsertVote.mockResolvedValue(ok({ changed: false }))
    repo.countByOption.mockResolvedValue(
      ok(
        new Map([
          [
            'pl1',
            new Map([
              [0, 3],
              [1, 1],
            ]),
          ],
        ]),
      ),
    )
    repo.listPolls.mockResolvedValue(ok([createFakePoll()]))
    repo.listVotes.mockResolvedValue(ok([vote()]))
    repo.personNames.mockResolvedValue(ok(new Map([['p1', 'Ana Lima']])))
    vi.mocked(loadNewsletterScope).mockResolvedValue(
      ok({
        membership: { role: 'MEMBER', isPrivileged: false, permissions: null },
        newsletter: createFakeNewsletter(),
      } as never),
    )
    vi.mocked(loadIssue).mockResolvedValue(
      ok(
        createFakeNewsletterIssue({
          status: 'SENT',
          number: 7,
          builderDocument: pollIssueDocument(),
        }),
      ),
    )
  })

  it('builds per-delivery vote links', () => {
    const url = pollVoteLinkFor('r9')('poll1', 2)
    const tokenPart = url.split('/newsletter/enquete/')[1]
    expect(verifyPollVoteToken(tokenPart)).toEqual({
      ok: true,
      value: { recipientId: 'r9', blockId: 'poll1', optionIndex: 2 },
    })
    expect(pollsOfDocument({ nope: true })).toEqual([])
  })

  describe('vote', () => {
    it('records the vote and returns the results', async () => {
      const result = expectOk(await Service.vote(token(1), NOW))
      expect(repo.ensurePoll).toHaveBeenCalledWith('ws1', 'is1', {
        blockId: 'poll1',
        question: 'Gostou?',
        options: [{ label: 'Sim' }, { label: 'Não' }, { label: 'Talvez' }],
        showResults: true,
      })
      expect(repo.upsertVote).toHaveBeenCalledWith({
        pollId: 'pl1',
        recipient: expect.objectContaining({ id: 'r1', personId: 'p1' }),
        optionIndex: 1,
        now: NOW,
      })
      expect(result).toEqual({
        newsletterName: 'Novidades Acme',
        question: 'Gostou?',
        chosenIndex: 1,
        chosenLabel: 'Não',
        changed: false,
        results: {
          totalVotes: 4,
          options: [
            { index: 0, label: 'Sim', votes: 3 },
            { index: 1, label: 'Não', votes: 1 },
            { index: 2, label: 'Talvez', votes: 0 },
          ],
        },
      })
    })

    it('hides the results when the author chose so', async () => {
      repo.ensurePoll.mockResolvedValueOnce(
        ok(createFakePoll({ showResults: false })),
      )
      repo.upsertVote.mockResolvedValueOnce(ok({ changed: true }))
      const result = expectOk(await Service.vote(token(0), NOW))
      expect(result.results).toBeNull()
      expect(result.changed).toBe(true)
      expect(repo.countByOption).not.toHaveBeenCalled()
    })

    it('falls back to the block label when the stored options are odd', async () => {
      repo.ensurePoll.mockResolvedValueOnce(
        ok(createFakePoll({ options: 'x' as never })),
      )
      const result = expectOk(await Service.vote(token(2), NOW))
      expect(result.chosenLabel).toBe('Talvez')
      repo.ensurePoll.mockResolvedValueOnce(
        ok(createFakePoll({ options: [{ label: 'A' }, 'b', null] as never })),
      )
      expect(expectOk(await Service.vote(token(1), NOW)).chosenLabel).toBe('')
    })

    it('refuses invalid tokens and unknown polls', async () => {
      expectErr(await Service.vote('bad', NOW), 'CRM_NEWSLETTER_TOKEN_INVALID')
      repo.findRecipient.mockResolvedValueOnce(ok(null))
      expectErr(
        await Service.vote(token(), NOW),
        'CRM_NEWSLETTER_POLL_NOT_FOUND',
      )
      repo.findRecipient.mockResolvedValueOnce(
        ok(recipient({ status: 'DRAFT' })),
      )
      expectErr(
        await Service.vote(token(), NOW),
        'CRM_NEWSLETTER_POLL_NOT_FOUND',
      )
      repo.findRecipient.mockResolvedValueOnce(
        ok(recipient({ deletedAt: NOW })),
      )
      expectErr(
        await Service.vote(token(), NOW),
        'CRM_NEWSLETTER_POLL_NOT_FOUND',
      )
      expectErr(
        await Service.vote(token(0, 'other'), NOW),
        'CRM_NEWSLETTER_POLL_NOT_FOUND',
      )
      expectErr(
        await Service.vote(token(3), NOW),
        'CRM_NEWSLETTER_POLL_NOT_FOUND',
      )
      expect(repo.upsertVote).not.toHaveBeenCalled()
    })

    it('propagates database errors', async () => {
      repo.findRecipient.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.vote(token(), NOW), 'DATABASE_ERROR')
      repo.ensurePoll.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.vote(token(), NOW), 'DATABASE_ERROR')
      repo.upsertVote.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.vote(token(), NOW), 'DATABASE_ERROR')
      repo.countByOption.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.vote(token(), NOW), 'DATABASE_ERROR')
    })
  })

  describe('report', () => {
    it('lists the document polls with counts and voters', async () => {
      const report = expectOk(await Service.report(...A))
      expect(loadNewsletterScope).toHaveBeenCalledWith(
        'u1',
        'ws1',
        'nl1',
        'VIEW',
      )
      expect(report.polls).toHaveLength(1)
      expect(report.polls[0]).toMatchObject({
        blockId: 'poll1',
        totalVotes: 4,
        votersTruncated: false,
        voters: [
          {
            id: 'v1',
            name: 'Ana Lima',
            email: 'ana@example.com',
            personId: 'p1',
            optionIndex: 0,
            votedAt: NOW.toISOString(),
          },
        ],
      })
      expect(repo.listVotes).toHaveBeenCalledWith(['pl1'], 201)
    })

    it('reports polls without votes and stored polls gone from the document', async () => {
      repo.listPolls.mockResolvedValueOnce(
        ok([
          createFakePoll({ id: 'pl2', blockId: 'gone', question: 'Antiga' }),
        ]),
      )
      repo.countByOption.mockResolvedValueOnce(ok(new Map()))
      repo.listVotes.mockResolvedValueOnce(
        ok([
          vote({ pollId: 'pl2', personId: 'deleted', recipientName: null }),
          vote({ id: 'v2', pollId: 'pl2', personId: null }),
        ]),
      )
      const report = expectOk(await Service.report(...A))
      expect(report.polls.map((poll) => poll.blockId)).toEqual([
        'poll1',
        'gone',
      ])
      expect(report.polls[0].totalVotes).toBe(0)
      expect(report.polls[0].voters).toEqual([])
      expect(report.polls[1].question).toBe('Antiga')
      expect(report.polls[1].voters[0]).toMatchObject({
        name: null,
        personId: null,
      })
      expect(report.polls[1].voters[1]).toMatchObject({ name: 'Ana' })
    })

    it('truncates the voters list', async () => {
      repo.listVotes.mockResolvedValueOnce(
        ok(Array.from({ length: 201 }, (_, i) => vote({ id: `v${i}` }))),
      )
      const report = expectOk(await Service.report(...A))
      expect(report.polls[0].voters).toHaveLength(200)
      expect(report.polls[0].votersTruncated).toBe(true)
    })

    it('propagates authorization and database errors', async () => {
      vi.mocked(loadNewsletterScope).mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.report(...A), 'FORBIDDEN')
      vi.mocked(loadIssue).mockResolvedValueOnce(
        err(crmNewsletterIssueNotFound()),
      )
      expectErr(await Service.report(...A), 'CRM_NEWSLETTER_ISSUE_NOT_FOUND')
      repo.listPolls.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.report(...A), 'DATABASE_ERROR')
      repo.countByOption.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.report(...A), 'DATABASE_ERROR')
      repo.listVotes.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.report(...A), 'DATABASE_ERROR')
      repo.personNames.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.report(...A), 'DATABASE_ERROR')
    })
  })

  describe('exportCsv', () => {
    it('exports every vote and audits it', async () => {
      repo.listVotes.mockResolvedValueOnce(
        ok([
          vote(),
          vote({
            id: 'v2',
            personId: null,
            recipientName: null,
            optionIndex: 9,
          }),
        ]),
      )
      const out = expectOk(await Service.exportCsv(...A))
      expect(out.filename).toBe('enquete-novidades-7.csv')
      expect(repo.listVotes).toHaveBeenCalledWith(['pl1'])
      const lines = out.csv.trim().split('\r\n')
      expect(lines[0]).toContain('Pergunta,Opção,E-mail,Nome,Pessoa no CRM')
      expect(lines[1]).toContain(
        'Gostou?,Sim,ana@example.com,Ana Lima,Sim,28/10/2026 10:00',
      )
      expect(lines[2]).toContain('Gostou?,,ana@example.com,,Não')
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'crm_newsletter_poll',
          action: 'export_completed',
          actorId: 'u1',
          targetId: 'is1',
          meta: { workspaceId: 'ws1', newsletterId: 'nl1', rows: 2 },
        }),
      )
    })

    it('names the file by slug before numbering and propagates errors', async () => {
      vi.mocked(loadIssue).mockResolvedValueOnce(
        ok(createFakeNewsletterIssue({ builderDocument: pollIssueDocument() })),
      )
      repo.listPolls.mockResolvedValueOnce(ok([]))
      repo.listVotes.mockResolvedValueOnce(ok([]))
      const out = expectOk(await Service.exportCsv(...A))
      expect(out.filename).toBe('enquete-novidades-novidades-de-outubro.csv')
      vi.mocked(loadNewsletterScope).mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.exportCsv(...A), 'FORBIDDEN')
      repo.listVotes.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.exportCsv(...A), 'DATABASE_ERROR')
      repo.personNames.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.exportCsv(...A), 'DATABASE_ERROR')
    })
  })
})
