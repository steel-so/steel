import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auditMutation } from '@/lib/axiom/audit'
import {
  createFakeQaConfig,
  createFakeQaCriterion,
  createFakeQaReview,
} from '@/src/__tests__/factories/nov-t2-qa.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden, moduleDisabled } from '@/src/errors'
import { getQaReviewQueue } from '@/src/lib/queue/queues'
import { err, ok } from '@/src/lib/result'
import { QaReviewRepository as Repo } from '@/src/repositories/qa-review.repository'
import { QaReviewSourceRepository as Source } from '@/src/repositories/qa-review-source.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { AiUsageService } from '../ai-usage.service'
import { assertMember, assertModuleEnabled } from '../authz'
import { emitNotification, workspaceAdminIds } from '../notification-emitter'
import { QaReviewService as Service } from '../qa-review.service'

vi.mock('@/src/repositories/qa-review.repository')
vi.mock('@/src/repositories/qa-review-source.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/sd-ticket.repository', () => ({}))
vi.mock('../ai-usage.service', () => ({
  AiUsageService: { prepare: vi.fn(), price: vi.fn(), record: vi.fn() },
}))
vi.mock('@/src/lib/queue/queues', () => ({ getQaReviewQueue: vi.fn() }))
vi.mock('../authz', () => ({
  assertMember: vi.fn(),
  assertModuleEnabled: vi.fn(),
}))
vi.mock('../notification-emitter', () => ({
  emitNotification: vi.fn(),
  workspaceAdminIds: vi.fn(),
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

const CRITERION = {
  key: 'tone',
  name: 'Tom',
  description: 'Cordial',
  weight: 1,
  appliesTo: 'BOTH' as const,
  active: true,
}
const add = vi.fn()
const chat = vi.fn()
const dbErr = () => err(databaseError('x'))
const member = (isPrivileged: boolean) =>
  ok({ role: isPrivileged ? 'ADMIN' : 'MEMBER', isPrivileged }) as never

const GOOD_ANSWER = JSON.stringify({
  criteria: [
    { key: 'tone', score: 90, evidence: 'Olá' },
    { key: 'resolution', score: 40, evidence: 'Não resolveu' },
    { key: 'compliance', score: 20, evidence: 'Sem protocolo' },
    { key: 'empathy', score: 30, evidence: 'Seco' },
  ],
  summary: 'Resumo',
  coachingTips: ['Dica 1'],
})

const msg = (
  direction: 'IN' | 'OUT',
  text: string,
  senderUserId: string | null = null,
  sentByAi = false,
) => ({ direction, text, senderUserId, sentByAi })

const tmsg = (
  authorKind: string,
  body: string,
  authorUserId: string | null = null,
) => ({ authorKind, visibility: 'PUBLIC', body, authorUserId })

function conversationSource(overrides: object = {}) {
  return {
    id: 'conv-1',
    assignedUserId: 'u1',
    assignedUserName: 'Carlos',
    customerName: 'Ana',
    endedAt: new Date('2026-11-03T12:00:00Z'),
    messages: [
      msg('IN', 'Oi'),
      msg('OUT', 'Olá', 'u1'),
      msg('IN', 'Preciso de ajuda'),
      msg('OUT', 'Claro', 'u1'),
    ],
    ...overrides,
  }
}

function ticketSource(overrides: object = {}) {
  return {
    id: 't-1',
    label: '#1 Erro',
    description: null,
    assigneeId: 'u1',
    assigneeName: 'Carlos',
    customerName: 'Acme',
    endedAt: null,
    messages: [
      tmsg('REQUESTER', 'a'),
      tmsg('AGENT', 'b', 'u1'),
      tmsg('REQUESTER', 'c'),
      tmsg('AGENT', 'd', 'u1'),
    ],
    ...overrides,
  }
}

const pending = (overrides: object = {}) =>
  createFakeQaReview({
    id: 'r1',
    status: 'PENDING',
    score: null,
    reviewedAt: null,
    ...overrides,
  })

beforeEach(() => {
  vi.resetAllMocks()
  add.mockResolvedValue(undefined)
  vi.mocked(getQaReviewQueue).mockReturnValue({ add } as never)
  vi.mocked(assertMember).mockResolvedValue(member(true))
  vi.mocked(assertModuleEnabled).mockResolvedValue(ok(true))
  vi.mocked(Repo.findConfig).mockResolvedValue(ok(createFakeQaConfig()))
  vi.mocked(Repo.listCriteria).mockResolvedValue(ok([]))
  vi.mocked(Repo.upsertConfig).mockResolvedValue(ok(createFakeQaConfig()))
  vi.mocked(Repo.replaceCriteria).mockResolvedValue(ok([]))
  vi.mocked(Repo.upsertPending).mockResolvedValue(ok(pending()))
  vi.mocked(Repo.update).mockImplementation(async (_id, data) =>
    ok(createFakeQaReview({ id: 'r1', ...(data as object) } as never)),
  )
  vi.mocked(Source.loadConversation).mockResolvedValue(
    ok(conversationSource() as never),
  )
  vi.mocked(Source.loadTicket).mockResolvedValue(ok(ticketSource() as never))
  vi.mocked(UserRepository.findById).mockResolvedValue(
    ok({ name: 'Maria' } as never),
  )
  vi.mocked(AiUsageService.prepare).mockResolvedValue(
    ok({
      provider: { chat },
      model: { provider: 'openai', model: 'gpt-test' },
    }) as never,
  )
  vi.mocked(AiUsageService.price).mockReturnValue(0.002)
  vi.mocked(AiUsageService.record).mockResolvedValue(undefined)
  vi.mocked(workspaceAdminIds).mockResolvedValue(['admin-1'])
  vi.mocked(emitNotification).mockResolvedValue(1)
  chat.mockResolvedValue({
    text: GOOD_ANSWER,
    usage: { inputTokens: 100, outputTokens: 50 },
  })
})

describe('QaReviewService access', () => {
  it('lets a member read the config when one module is on', async () => {
    vi.mocked(assertModuleEnabled)
      .mockResolvedValueOnce(err(moduleDisabled()))
      .mockResolvedValueOnce(ok(true))
    const config = expectOk(await Service.getConfig('u', 'ws'))
    expect(config.enabled).toBe(true)
    expect(config.criteria).toHaveLength(4)
  })

  it('denies non-members and workspaces with both modules off', async () => {
    vi.mocked(assertMember).mockResolvedValue(err(forbidden()))
    expectErr(await Service.getConfig('u', 'ws'), 'FORBIDDEN')
    vi.mocked(assertMember).mockResolvedValue(member(true))
    vi.mocked(assertModuleEnabled).mockResolvedValue(err(moduleDisabled()))
    expectErr(await Service.getConfig('u', 'ws'), 'MODULE_DISABLED')
  })

  it('propagates database errors reading the config', async () => {
    vi.mocked(Repo.findConfig).mockResolvedValue(dbErr())
    expectErr(await Service.getConfig('u', 'ws'), 'DATABASE_ERROR')
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(null))
    vi.mocked(Repo.listCriteria).mockResolvedValue(dbErr())
    expectErr(await Service.getConfig('u', 'ws'), 'DATABASE_ERROR')
  })
})

describe('QaReviewService.updateConfig', () => {
  it('saves only the given fields and replaces the criteria', async () => {
    const criteria = [CRITERION]
    expectOk(
      await Service.updateConfig('u', 'ws', { enabled: true, criteria }),
    )
    expect(Repo.upsertConfig).toHaveBeenCalledWith('ws', { enabled: true })
    expect(Repo.replaceCriteria).toHaveBeenCalledWith('ws', criteria)
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'qa_config', action: 'update' }),
    )
  })

  it('does not touch the criteria when none are sent', async () => {
    vi.mocked(Repo.listCriteria).mockResolvedValue(
      ok([createFakeQaCriterion()]),
    )
    expectOk(await Service.updateConfig('u', 'ws', { minMessages: 3 }))
    expect(Repo.replaceCriteria).not.toHaveBeenCalled()
  })

  it('is for managers only and surfaces database errors', async () => {
    vi.mocked(assertMember).mockResolvedValue(member(false))
    expectErr(await Service.updateConfig('u', 'ws', {}), 'FORBIDDEN')
    vi.mocked(assertMember).mockResolvedValue(err(forbidden()))
    expectErr(await Service.updateConfig('u', 'ws', {}), 'FORBIDDEN')
    vi.mocked(assertMember).mockResolvedValue(member(true))
    vi.mocked(Repo.upsertConfig).mockResolvedValue(dbErr())
    expectErr(await Service.updateConfig('u', 'ws', {}), 'DATABASE_ERROR')
    vi.mocked(Repo.upsertConfig).mockResolvedValue(ok(createFakeQaConfig()))
    vi.mocked(Repo.replaceCriteria).mockResolvedValue(dbErr())
    expectErr(
      await Service.updateConfig('u', 'ws', {
        criteria: [CRITERION],
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('QaReviewService reads', () => {
  const query = { limit: 25, lowOnly: false, agentUserId: 'u9' }

  it('lets a manager filter by agent and a member see only their own', async () => {
    vi.mocked(Repo.list).mockResolvedValue(
      ok({ items: [createFakeQaReview()], nextCursor: 'n' }),
    )
    const page = expectOk(await Service.list('me', 'ws', query))
    expect(page).toMatchObject({ nextCursor: 'n' })
    expect(page.items).toHaveLength(1)
    expect(Repo.list).toHaveBeenLastCalledWith(
      'ws',
      expect.objectContaining({ agentUserId: 'u9' }),
      { cursor: undefined, limit: 25 },
    )

    vi.mocked(assertMember).mockResolvedValue(member(false))
    expectOk(await Service.list('me', 'ws', query))
    expect(Repo.list).toHaveBeenLastCalledWith(
      'ws',
      expect.objectContaining({ agentUserId: 'me' }),
      expect.anything(),
    )
  })

  it('propagates list errors and denials', async () => {
    vi.mocked(Repo.list).mockResolvedValue(dbErr())
    expectErr(await Service.list('me', 'ws', query), 'DATABASE_ERROR')
    vi.mocked(assertMember).mockResolvedValue(err(forbidden()))
    expectErr(await Service.list('me', 'ws', query), 'FORBIDDEN')
  })

  it('gets one review within the workspace and hides others from members', async () => {
    vi.mocked(Repo.findInWorkspace).mockResolvedValue(
      ok(createFakeQaReview({ agentUserId: 'u1' })),
    )
    expectOk(await Service.get('me', 'ws', 'r1'))

    vi.mocked(assertMember).mockResolvedValue(member(false))
    expectErr(await Service.get('me', 'ws', 'r1'), 'FORBIDDEN')
    expectOk(await Service.get('u1', 'ws', 'r1'))

    vi.mocked(Repo.findInWorkspace).mockResolvedValue(ok(null))
    expectErr(await Service.get('u1', 'ws', 'r1'), 'QA_REVIEW_NOT_FOUND')
    vi.mocked(Repo.findInWorkspace).mockResolvedValue(dbErr())
    expectErr(await Service.get('u1', 'ws', 'r1'), 'DATABASE_ERROR')
    vi.mocked(assertMember).mockResolvedValue(err(forbidden()))
    expectErr(await Service.get('u1', 'ws', 'r1'), 'FORBIDDEN')
  })

  it('builds the coaching panel over the last 30 days by default', async () => {
    vi.mocked(Repo.listCompleted).mockResolvedValue(
      ok([createFakeQaReview(), createFakeQaReview({ agentUserId: 'u2' })]),
    )
    const panel = expectOk(await Service.coaching('me', 'ws', {}))
    expect(panel.agents).toHaveLength(2)
    const [, range, agent] = vi.mocked(Repo.listCompleted).mock.calls[0]
    expect(range.to.getTime() - range.from.getTime()).toBe(30 * 86_400_000)
    expect(agent).toBeUndefined()
  })

  it('scopes the coaching of a member to themselves', async () => {
    vi.mocked(assertMember).mockResolvedValue(member(false))
    vi.mocked(Repo.listCompleted).mockResolvedValue(ok([]))
    const from = new Date('2026-10-01T00:00:00Z')
    const to = new Date('2026-10-31T00:00:00Z')
    expectOk(await Service.coaching('me', 'ws', { from, to, agentUserId: 'x' }))
    expect(Repo.listCompleted).toHaveBeenCalledWith('ws', { from, to }, 'me')
  })

  it('propagates coaching errors', async () => {
    vi.mocked(Repo.listCompleted).mockResolvedValue(dbErr())
    expectErr(await Service.coaching('me', 'ws', {}), 'DATABASE_ERROR')
    vi.mocked(assertMember).mockResolvedValue(err(forbidden()))
    expectErr(await Service.coaching('me', 'ws', {}), 'FORBIDDEN')
  })
})

describe('QaReviewService.requestReview', () => {
  it('schedules a conversation review right away', async () => {
    const dto = expectOk(
      await Service.requestReview('u', 'ws', {
        subjectType: 'CONVERSATION',
        subjectId: 'conv-1',
      }),
    )
    expect(dto.id).toBe('r1')
    expect(Repo.upsertPending).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws',
        subjectType: 'CONVERSATION',
        conversationId: 'conv-1',
      }),
    )
    expect(add).toHaveBeenCalledWith(
      'review',
      { reviewId: 'r1' },
      expect.objectContaining({ delay: 0 }),
    )
    expect(auditMutation).toHaveBeenCalled()
  })

  it('schedules a ticket review with its label', async () => {
    expectOk(
      await Service.requestReview('u', 'ws', {
        subjectType: 'TICKET',
        subjectId: 't-1',
      }),
    )
    expect(Repo.upsertPending).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 't-1', subjectLabel: '#1 Erro' }),
    )
  })

  it('fails when the QA is off, the subject is unknown or storage fails', async () => {
    const conv = { subjectType: 'CONVERSATION' as const, subjectId: 'c' }
    const tick = { subjectType: 'TICKET' as const, subjectId: 't' }
    vi.mocked(assertMember).mockResolvedValue(member(false))
    expectErr(await Service.requestReview('u', 'ws', conv), 'FORBIDDEN')
    vi.mocked(assertMember).mockResolvedValue(member(true))

    vi.mocked(Repo.findConfig).mockResolvedValue(
      ok(createFakeQaConfig({ enabled: false })),
    )
    expectErr(await Service.requestReview('u', 'ws', conv), 'QA_DISABLED')
    vi.mocked(Repo.findConfig).mockResolvedValue(dbErr())
    expectErr(await Service.requestReview('u', 'ws', conv), 'DATABASE_ERROR')
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(createFakeQaConfig()))

    vi.mocked(Source.loadConversation).mockResolvedValue(ok(null))
    expectErr(await Service.requestReview('u', 'ws', conv), 'QA_SUBJECT_NOT_FOUND')
    vi.mocked(Source.loadTicket).mockResolvedValue(ok(null))
    expectErr(await Service.requestReview('u', 'ws', tick), 'QA_SUBJECT_NOT_FOUND')
    vi.mocked(Source.loadConversation).mockResolvedValue(dbErr())
    expectErr(await Service.requestReview('u', 'ws', conv), 'DATABASE_ERROR')
    vi.mocked(Source.loadTicket).mockResolvedValue(dbErr())
    expectErr(await Service.requestReview('u', 'ws', tick), 'DATABASE_ERROR')

    vi.mocked(Source.loadTicket).mockResolvedValue(ok(ticketSource() as never))
    vi.mocked(Repo.upsertPending).mockResolvedValue(dbErr())
    expectErr(await Service.requestReview('u', 'ws', tick), 'DATABASE_ERROR')
  })
})

describe('QaReviewService triggers', () => {
  const conversation = {
    id: 'conv-1',
    workspaceId: 'ws',
    firstInboundAt: new Date(),
  }

  it('queues a delayed review when a conversation closes', async () => {
    const review = expectOk(await Service.onConversationClosed(conversation))
    expect(review?.id).toBe('r1')
    expect(add).toHaveBeenCalledWith(
      'review',
      { reviewId: 'r1' },
      expect.objectContaining({ delay: 60_000 }),
    )
  })

  it('does nothing when the QA is off, the kind is off or nobody wrote', async () => {
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(null))
    expect(expectOk(await Service.onConversationClosed(conversation))).toBeNull()
    vi.mocked(Repo.findConfig).mockResolvedValue(
      ok(createFakeQaConfig({ reviewConversations: false })),
    )
    expect(expectOk(await Service.onConversationClosed(conversation))).toBeNull()
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(createFakeQaConfig()))
    expect(
      expectOk(
        await Service.onConversationClosed({
          ...conversation,
          firstInboundAt: null,
        }),
      ),
    ).toBeNull()
    expect(add).not.toHaveBeenCalled()
  })

  it('propagates storage errors when a conversation closes', async () => {
    vi.mocked(Repo.findConfig).mockResolvedValue(dbErr())
    expectErr(await Service.onConversationClosed(conversation), 'DATABASE_ERROR')
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(createFakeQaConfig()))
    vi.mocked(Repo.upsertPending).mockResolvedValue(dbErr())
    expectErr(await Service.onConversationClosed(conversation), 'DATABASE_ERROR')
  })

  it('queues a review when a ticket is resolved and respects the switches', async () => {
    const ticket = { id: 't-1', workspaceId: 'ws' }
    expectOk(await Service.onTicketResolved(ticket))
    expect(Repo.upsertPending).toHaveBeenCalledWith(
      expect.objectContaining({ subjectType: 'TICKET', ticketId: 't-1' }),
    )
    expect(add).toHaveBeenCalledTimes(1)

    vi.mocked(Repo.findConfig).mockResolvedValue(
      ok(createFakeQaConfig({ reviewTickets: false })),
    )
    expect(expectOk(await Service.onTicketResolved(ticket))).toBeNull()
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(null))
    expect(expectOk(await Service.onTicketResolved(ticket))).toBeNull()
    vi.mocked(Repo.findConfig).mockResolvedValue(dbErr())
    expectErr(await Service.onTicketResolved(ticket), 'DATABASE_ERROR')
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(createFakeQaConfig()))
    vi.mocked(Repo.upsertPending).mockResolvedValue(dbErr())
    expectErr(await Service.onTicketResolved(ticket), 'DATABASE_ERROR')
  })
})

describe('QaReviewService.run', () => {
  const arrange = (review = pending()) =>
    vi.mocked(Repo.findById).mockResolvedValue(ok(review))

  it('scores a conversation, stores the result and records the AI usage', async () => {
    arrange()
    const outcome = expectOk(await Service.run('r1'))
    // (90*2 + 40*4 + 20*3 + 30*2) / 11 = 41.8
    expect(outcome).toEqual({ status: 'completed', score: 42, lowScore: true })
    expect(Repo.update).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        status: 'COMPLETED',
        score: 42,
        lowScore: true,
        handlerKind: 'HUMAN',
        agentUserId: 'u1',
        agentName: 'Carlos',
        customerName: 'Ana',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.002,
      }),
    )
    expect(AiUsageService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: 'ws-1', userId: null }),
    )
    expect(AiUsageService.prepare).toHaveBeenCalledWith('ws-1', 'QA_REVIEW', null)
    expect(emitNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'QA_LOW_SCORE',
        recipients: ['admin-1'],
        dedupeKey: 'qa-low-score:r1',
      }),
    )
  })

  it('scores a ticket and keeps a good score quiet', async () => {
    arrange(
      pending({
        subjectType: 'TICKET',
        conversationId: null,
        ticketId: 't-1',
      }),
    )
    chat.mockResolvedValue({
      text: JSON.stringify({
        criteria: [
          { key: 'tone', score: 95, evidence: 'a' },
          { key: 'resolution', score: 90, evidence: 'b' },
          { key: 'compliance', score: 90, evidence: 'c' },
          { key: 'empathy', score: 90, evidence: 'd' },
        ],
        summary: 'ok',
        coachingTips: [],
      }),
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    const outcome = expectOk(await Service.run('r1'))
    expect(outcome).toMatchObject({ status: 'completed', lowScore: false })
    expect(Source.loadTicket).toHaveBeenCalledWith('ws-1', 't-1')
    expect(Repo.update).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ subjectLabel: '#1 Erro' }),
    )
    expect(emitNotification).not.toHaveBeenCalled()
  })

  it('does not alert when the workspace turned the alert off', async () => {
    arrange()
    vi.mocked(Repo.findConfig).mockResolvedValue(
      ok(createFakeQaConfig({ alertLowScore: false })),
    )
    expectOk(await Service.run('r1'))
    expect(emitNotification).not.toHaveBeenCalled()
  })

  it('swallows alert failures, with and without an Error', async () => {
    arrange()
    vi.mocked(workspaceAdminIds).mockRejectedValue(new Error('boom'))
    expect(expectOk(await Service.run('r1')).status).toBe('completed')
    vi.mocked(workspaceAdminIds).mockRejectedValue('boom')
    expect(expectOk(await Service.run('r1')).status).toBe('completed')
  })

  it('words the alert for a ticket with its agent', async () => {
    arrange(
      pending({
        subjectType: 'TICKET',
        conversationId: null,
        ticketId: 't-1',
      }),
    )
    vi.mocked(Repo.update).mockImplementation(async (_id, data) =>
      ok(
        createFakeQaReview({
          id: 'r1',
          subjectType: 'TICKET',
          subjectLabel: '#1 Erro',
          agentName: 'Carlos',
          ...(data as object),
        } as never),
      ),
    )
    expectOk(await Service.run('r1'))
    expect(emitNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('O chamado #1 Erro atendido por Carlos'),
      }),
    )
  })

  it('ignores reviews that are not pending', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(ok(null))
    expect(expectOk(await Service.run('r1'))).toEqual({
      status: 'skipped',
      reason: 'not_pending',
    })
    arrange(createFakeQaReview({ status: 'COMPLETED' }))
    expect(expectOk(await Service.run('r1')).status).toBe('skipped')
    vi.mocked(Repo.findById).mockResolvedValue(dbErr())
    expectErr(await Service.run('r1'), 'DATABASE_ERROR')
  })

  it.each([
    ['disabled', () => vi.mocked(Repo.findConfig).mockResolvedValue(ok(createFakeQaConfig({ enabled: false })))],
    ['subject_not_found', () => vi.mocked(Source.loadConversation).mockResolvedValue(ok(null))],
    ['no_attendant_reply', () => vi.mocked(Source.loadConversation).mockResolvedValue(ok(conversationSource({ messages: [msg('IN', 'a'), msg('IN', 'b'), msg('IN', 'c'), msg('IN', 'd')] }) as never))],
    ['too_short', () => vi.mocked(Source.loadConversation).mockResolvedValue(ok(conversationSource({ messages: [msg('IN', 'a'), msg('OUT', 'b', 'u1')] }) as never))],
    ['bots_excluded', () => {
      vi.mocked(Repo.findConfig).mockResolvedValue(ok(createFakeQaConfig({ includeBots: false })))
      vi.mocked(Source.loadConversation).mockResolvedValue(ok(conversationSource({ messages: [msg('IN', 'a'), msg('OUT', 'b', null, true), msg('IN', 'c'), msg('OUT', 'd', null, true)] }) as never))
    }],
    ['no_criteria', () => vi.mocked(Repo.listCriteria).mockResolvedValue(ok([createFakeQaCriterion({ active: false })]))],
    ['ai_quota_exceeded', () => vi.mocked(AiUsageService.prepare).mockResolvedValue(err({ code: 'AI_QUOTA_EXCEEDED' } as never))],
    ['ai_provider_unavailable', () => vi.mocked(AiUsageService.prepare).mockResolvedValue(err({ code: 'AI_PROVIDER_UNAVAILABLE' } as never))],
    ['ai_prepare_failed', () => vi.mocked(AiUsageService.prepare).mockResolvedValue(err({ code: 'OTHER' } as never))],
  ])('skips with %s', async (reason, setup) => {
    arrange()
    setup()
    expect(expectOk(await Service.run('r1'))).toEqual({
      status: 'skipped',
      reason,
    })
    expect(Repo.update).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'SKIPPED', skipReason: reason }),
    )
    expect(chat).not.toHaveBeenCalled()
  })

  it('skips a review that points at no subject', async () => {
    arrange(pending({ conversationId: null, ticketId: null }))
    expect(expectOk(await Service.run('r1'))).toEqual({
      status: 'skipped',
      reason: 'subject_not_found',
    })
  })

  it('files bot-only attendances under no agent', async () => {
    arrange()
    vi.mocked(Source.loadConversation).mockResolvedValue(
      ok(
        conversationSource({
          messages: [
            msg('IN', 'a'),
            msg('OUT', 'b', null, true),
            msg('IN', 'c'),
            msg('OUT', 'd', null, true),
          ],
        }) as never,
      ),
    )
    expectOk(await Service.run('r1'))
    expect(Repo.update).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        handlerKind: 'BOT',
        agentUserId: null,
        agentName: null,
      }),
    )
  })

  it('attributes an unassigned conversation to whoever answered it', async () => {
    arrange()
    vi.mocked(Source.loadConversation).mockResolvedValue(
      ok(conversationSource({ assignedUserId: null, assignedUserName: null }) as never),
    )
    expectOk(await Service.run('r1'))
    expect(UserRepository.findById).toHaveBeenCalledWith('u1')
    expect(Repo.update).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ agentUserId: 'u1', agentName: 'Maria' }),
    )
  })

  it('keeps the agent id when their name cannot be read', async () => {
    arrange()
    vi.mocked(UserRepository.findById).mockResolvedValue(dbErr() as never)
    vi.mocked(Source.loadConversation).mockResolvedValue(
      ok(conversationSource({ assignedUserName: null }) as never),
    )
    expectOk(await Service.run('r1'))
    expect(Repo.update).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ agentUserId: 'u1', agentName: null }),
    )
  })

  it('leaves the agent empty when nobody can be named', async () => {
    arrange(
      pending({
        subjectType: 'TICKET',
        conversationId: null,
        ticketId: 't-1',
      }),
    )
    vi.mocked(Source.loadTicket).mockResolvedValue(
      ok(
        ticketSource({
          assigneeId: null,
          assigneeName: null,
          messages: [
            tmsg('REQUESTER', 'a'),
            tmsg('AGENT', 'b'),
            tmsg('REQUESTER', 'c'),
            tmsg('AGENT', 'd'),
          ],
        }) as never,
      ),
    )
    expectOk(await Service.run('r1'))
    expect(UserRepository.findById).not.toHaveBeenCalled()
    expect(Repo.update).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ handlerKind: 'HUMAN', agentUserId: null }),
    )
  })

  it('marks the review FAILED when the provider throws', async () => {
    arrange()
    chat.mockRejectedValue(new Error('timeout'))
    expect(expectOk(await Service.run('r1'))).toEqual({
      status: 'failed',
      reason: 'provider_failed',
    })
    chat.mockRejectedValue('timeout')
    expect(expectOk(await Service.run('r1')).status).toBe('failed')
    expect(AiUsageService.record).not.toHaveBeenCalled()
    expect(Repo.update).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'FAILED', skipReason: 'provider_failed' }),
    )
  })

  it('marks the review FAILED, still charging the tokens, on an unusable answer', async () => {
    arrange()
    chat.mockResolvedValue({
      text: 'sem json',
      usage: { inputTokens: 10, outputTokens: 5 },
    })
    expect(expectOk(await Service.run('r1'))).toEqual({
      status: 'failed',
      reason: 'unparseable_response',
    })
    expect(AiUsageService.record).toHaveBeenCalledTimes(1)
  })

  it('propagates database errors at every write', async () => {
    arrange()
    vi.mocked(Repo.findConfig).mockResolvedValue(dbErr())
    expectErr(await Service.run('r1'), 'DATABASE_ERROR')
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(createFakeQaConfig()))

    vi.mocked(Source.loadConversation).mockResolvedValue(dbErr())
    expectErr(await Service.run('r1'), 'DATABASE_ERROR')
    vi.mocked(Source.loadConversation).mockResolvedValue(
      ok(conversationSource() as never),
    )

    vi.mocked(Repo.update).mockResolvedValue(dbErr())
    expectErr(await Service.run('r1'), 'DATABASE_ERROR')

    chat.mockRejectedValue(new Error('x'))
    expectErr(await Service.run('r1'), 'DATABASE_ERROR')
    chat.mockResolvedValue({ text: 'x', usage: { inputTokens: 1, outputTokens: 1 } })
    expectErr(await Service.run('r1'), 'DATABASE_ERROR')

    vi.mocked(AiUsageService.prepare).mockResolvedValue(
      err({ code: 'AI_QUOTA_EXCEEDED' } as never),
    )
    expectErr(await Service.run('r1'), 'DATABASE_ERROR')
  })
})
