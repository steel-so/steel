import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeAiFeedback } from '@/src/__tests__/factories/ai-quality.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/ai-feedback.repository')
vi.mock('@/src/services/authz', () => ({ assertMember: vi.fn() }))
vi.mock('@/src/services/sd-access', () => ({
  SdAccess: { requireAgent: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-conversation.service', () => ({
  WhatsAppConversationService: { get: vi.fn() },
}))
vi.mock('@/src/services/ai-usage.service', () => ({
  AiUsageService: { resolveModel: vi.fn() },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { AiFeedbackRepository } from '@/src/repositories/ai-feedback.repository'
import type { UpsertAiFeedbackInput } from '@/src/schemas/ai-feedback.schema'
import { AiUsageService } from '@/src/services/ai-usage.service'
import { assertMember } from '@/src/services/authz'
import { SdAccess } from '@/src/services/sd-access'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import { AiFeedbackService } from '../ai-feedback.service'

const repo = vi.mocked(AiFeedbackRepository)
const member = vi.mocked(assertMember)
const sd = vi.mocked(SdAccess)
const zap = vi.mocked(WhatsAppConversationService)
const usage = vi.mocked(AiUsageService)
const audit = vi.mocked(auditMutation)

const ACTOR = 'user_1'
const WS = 'ws_1'

function input(
  over: Partial<UpsertAiFeedbackInput> = {},
): UpsertAiFeedbackInput {
  return {
    surface: 'STEEL_AI_MESSAGE',
    targetId: 'm1',
    variant: '',
    rating: 'UP',
    reason: null,
    comment: null,
    ...over,
  }
}

const MEMBERSHIP = { role: 'MEMBER', isPrivileged: false, permissions: null }

beforeEach(() => {
  vi.clearAllMocks()
  member.mockResolvedValue(ok(MEMBERSHIP) as never)
  sd.requireAgent.mockResolvedValue(ok({}) as never)
  zap.get.mockResolvedValue(ok({}) as never)
  usage.resolveModel.mockResolvedValue(
    ok({ settings: {}, model: { key: 'openai:gpt-4o-mini' } }) as never,
  )
  repo.upsert.mockImplementation(async (data) =>
    ok(
      createFakeAiFeedback({
        ...data,
        id: 'fb_1',
        reason: data.reason,
      }),
    ),
  )
  repo.findAssistantMessage.mockResolvedValue(
    ok({
      id: 'm1',
      role: 'ASSISTANT',
      modelKey: 'anthropic:claude-sonnet-5',
      conversationId: 'c1',
      conversationWorkspaceId: WS,
      conversationUserId: ACTOR,
    }),
  )
  repo.findAgentRun.mockResolvedValue(
    ok({ id: 'r1', agentId: 'a1', modelKey: 'openai:gpt-4o' }),
  )
  repo.findTicket.mockResolvedValue(
    ok({ id: 't1', number: 7, aiTriage: { model: 'openai:gpt-4o-mini' } }),
  )
  repo.findKbDraft.mockResolvedValue(ok({ id: 'k1', sourceTicketId: 't1' }))
  repo.findWhatsAppMessage.mockResolvedValue(
    ok({ id: 'w1', conversationId: 'wc1', sentByAi: true, direction: 'OUT' }),
  )
})

describe('AiFeedbackService.rate', () => {
  it('rates a Steel AI answer with the model that wrote it', async () => {
    const dto = expectOk(await AiFeedbackService.rate(ACTOR, WS, input()))
    expect(dto.id).toBe('fb_1')
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ACTOR,
        modelKey: 'anthropic:claude-sonnet-5',
        module: null,
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'ai_feedback', action: 'create' }),
    )
    // The comment is personal data: never in the audit log.
    expect(JSON.stringify(audit.mock.calls)).not.toContain('comment":')
  })

  it('audits a re-rating as an update and drops the reason of a thumbs up', async () => {
    repo.upsert.mockImplementationOnce(async (data) =>
      ok(
        createFakeAiFeedback({
          ...data,
          createdAt: new Date('2026-10-01T00:00:00.000Z'),
          updatedAt: new Date('2026-10-02T00:00:00.000Z'),
        }),
      ),
    )
    expectOk(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ rating: 'DOWN', reason: 'tone', comment: 'grosso' }),
      ),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update' }),
    )
    expect(repo.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'tone', comment: 'grosso' }),
    )
  })

  it('denies non-members', async () => {
    member.mockResolvedValueOnce(err(forbidden()) as never)
    expectErr(await AiFeedbackService.rate(ACTOR, WS, input()), 'FORBIDDEN')
    expect(repo.upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', null],
    ['another user', { conversationUserId: 'other' }],
    ['another workspace', { conversationWorkspaceId: 'ws_2' }],
    ['a user turn', { role: 'USER' }],
  ])('refuses a Steel AI message from %s', async (_label, patch) => {
    repo.findAssistantMessage.mockResolvedValueOnce(
      ok(
        patch === null
          ? null
          : {
              id: 'm1',
              role: 'ASSISTANT',
              modelKey: null,
              conversationId: 'c1',
              conversationWorkspaceId: WS,
              conversationUserId: ACTOR,
              ...patch,
            },
      ),
    )
    expectErr(
      await AiFeedbackService.rate(ACTOR, WS, input()),
      'AI_FEEDBACK_TARGET_NOT_FOUND',
    )
  })

  it('rates an agent run when the member sees the agents', async () => {
    expectOk(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'STEEL_AGENT_RUN', targetId: 'r1' }),
      ),
    )
    expect(member).toHaveBeenCalledWith(ACTOR, WS, {
      resource: 'steel-agents',
      action: 'VIEW',
    })
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ modelKey: 'openai:gpt-4o' }),
    )
  })

  it('refuses an agent run without access or gone', async () => {
    member
      .mockResolvedValueOnce(ok(MEMBERSHIP) as never)
      .mockResolvedValueOnce(err(forbidden()) as never)
    expectErr(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'STEEL_AGENT_RUN' }),
      ),
      'FORBIDDEN',
    )
    repo.findAgentRun.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'STEEL_AGENT_RUN' }),
      ),
      'AI_FEEDBACK_TARGET_NOT_FOUND',
    )
  })

  it('rates the copilot with the configured model', async () => {
    expectOk(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'SD_COPILOT', targetId: 't1', variant: 'summary' }),
      ),
    )
    expect(usage.resolveModel).toHaveBeenCalledWith(
      WS,
      'SERVICEDESK_COPILOT',
      ACTOR,
    )
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'summary',
        modelKey: 'openai:gpt-4o-mini',
        module: 'SERVICE_DESK',
      }),
    )
  })

  it('keeps no model when it cannot be resolved', async () => {
    usage.resolveModel.mockResolvedValueOnce(err(databaseError('x')) as never)
    expectOk(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'SD_COPILOT', targetId: 't1', variant: 'reply' }),
      ),
    )
    expect(repo.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ modelKey: null }),
    )
    usage.resolveModel.mockResolvedValueOnce(
      ok({ settings: {}, model: null }) as never,
    )
    expectOk(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'SD_COPILOT', targetId: 't1', variant: 'reply' }),
      ),
    )
    expect(repo.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ modelKey: null }),
    )
  })

  it('rates the triage with the model it recorded', async () => {
    expectOk(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'SD_TRIAGE', targetId: 't1' }),
      ),
    )
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ modelKey: 'openai:gpt-4o-mini' }),
    )
    repo.findTicket.mockResolvedValueOnce(
      ok({ id: 't1', number: 7, aiTriage: { model: 3 } }),
    )
    expectOk(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'SD_TRIAGE', targetId: 't1' }),
      ),
    )
    expect(repo.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ modelKey: null }),
    )
    repo.findTicket.mockResolvedValueOnce(
      ok({ id: 't1', number: 7, aiTriage: 'odd' }),
    )
    expectOk(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'SD_TRIAGE', targetId: 't1' }),
      ),
    )
  })

  it('refuses ServiceDesk targets without agent access, gone or never triaged', async () => {
    sd.requireAgent.mockResolvedValueOnce(err(forbidden()) as never)
    expectErr(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'SD_COPILOT', variant: 'summary' }),
      ),
      'FORBIDDEN',
    )
    repo.findTicket.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'SD_COPILOT', variant: 'summary' }),
      ),
      'AI_FEEDBACK_TARGET_NOT_FOUND',
    )
    repo.findTicket.mockResolvedValueOnce(
      ok({ id: 't1', number: 7, aiTriage: null }),
    )
    expectErr(
      await AiFeedbackService.rate(ACTOR, WS, input({ surface: 'SD_TRIAGE' })),
      'AI_FEEDBACK_TARGET_NOT_FOUND',
    )
    repo.findTicket.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiFeedbackService.rate(ACTOR, WS, input({ surface: 'SD_TRIAGE' })),
      'DATABASE_ERROR',
    )
  })

  it('rates a KCS draft that came from a ticket', async () => {
    expectOk(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'SD_KCS_DRAFT', targetId: 'k1' }),
      ),
    )
    repo.findKbDraft.mockResolvedValueOnce(
      ok({ id: 'k1', sourceTicketId: null }),
    )
    expectErr(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'SD_KCS_DRAFT', targetId: 'k1' }),
      ),
      'AI_FEEDBACK_TARGET_NOT_FOUND',
    )
    sd.requireAgent.mockResolvedValueOnce(err(forbidden()) as never)
    expectErr(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'SD_KCS_DRAFT' }),
      ),
      'FORBIDDEN',
    )
    repo.findKbDraft.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'SD_KCS_DRAFT' }),
      ),
      'DATABASE_ERROR',
    )
  })

  it('rates a WhatsApp auto-reply with the conversation visibility', async () => {
    expectOk(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'WHATSAPP_AUTO_REPLY', targetId: 'w1' }),
      ),
    )
    expect(zap.get).toHaveBeenCalledWith(ACTOR, WS, 'wc1')
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'COMMUNICATION' }),
    )
  })

  it('refuses WhatsApp messages not sent by the AI or out of the team', async () => {
    const wa = input({ surface: 'WHATSAPP_AUTO_REPLY', targetId: 'w1' })
    repo.findWhatsAppMessage.mockResolvedValueOnce(
      ok({
        id: 'w1',
        conversationId: 'wc1',
        sentByAi: false,
        direction: 'OUT',
      }),
    )
    expectErr(
      await AiFeedbackService.rate(ACTOR, WS, wa),
      'AI_FEEDBACK_TARGET_NOT_FOUND',
    )
    repo.findWhatsAppMessage.mockResolvedValueOnce(
      ok({ id: 'w1', conversationId: 'wc1', sentByAi: true, direction: 'IN' }),
    )
    expectErr(
      await AiFeedbackService.rate(ACTOR, WS, wa),
      'AI_FEEDBACK_TARGET_NOT_FOUND',
    )
    repo.findWhatsAppMessage.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiFeedbackService.rate(ACTOR, WS, wa),
      'AI_FEEDBACK_TARGET_NOT_FOUND',
    )
    zap.get.mockResolvedValueOnce(err(forbidden()) as never)
    expectErr(await AiFeedbackService.rate(ACTOR, WS, wa), 'FORBIDDEN')
    repo.findWhatsAppMessage.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiFeedbackService.rate(ACTOR, WS, wa), 'DATABASE_ERROR')
  })

  it('propagates database errors', async () => {
    repo.findAssistantMessage.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiFeedbackService.rate(ACTOR, WS, input()),
      'DATABASE_ERROR',
    )
    repo.findAgentRun.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiFeedbackService.rate(
        ACTOR,
        WS,
        input({ surface: 'STEEL_AGENT_RUN' }),
      ),
      'DATABASE_ERROR',
    )
    repo.upsert.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiFeedbackService.rate(ACTOR, WS, input()),
      'DATABASE_ERROR',
    )
  })
})

describe('AiFeedbackService.listMine', () => {
  it('lists the caller ratings', async () => {
    repo.listMine.mockResolvedValueOnce(ok([createFakeAiFeedback()]))
    const rows = expectOk(
      await AiFeedbackService.listMine(ACTOR, WS, {
        surface: 'STEEL_AI_MESSAGE',
        targetIds: ['m1'],
      }),
    )
    expect(rows).toHaveLength(1)
    expect(repo.listMine).toHaveBeenCalledWith(ACTOR, WS, 'STEEL_AI_MESSAGE', [
      'm1',
    ])
  })

  it('denies non-members and propagates errors', async () => {
    member.mockResolvedValueOnce(err(forbidden()) as never)
    const query = { surface: 'STEEL_AI_MESSAGE' as const, targetIds: ['m1'] }
    expectErr(await AiFeedbackService.listMine(ACTOR, WS, query), 'FORBIDDEN')
    repo.listMine.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await AiFeedbackService.listMine(ACTOR, WS, query),
      'DATABASE_ERROR',
    )
  })
})

describe('AiFeedbackService.remove', () => {
  it('removes the caller own rating', async () => {
    repo.findById.mockResolvedValueOnce(
      ok(createFakeAiFeedback({ id: 'fb_1', userId: ACTOR })),
    )
    repo.delete.mockResolvedValueOnce(ok(undefined))
    expectOk(await AiFeedbackService.remove(ACTOR, WS, 'fb_1'))
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', targetId: 'fb_1' }),
    )
  })

  it('hides ratings of other people and missing ones', async () => {
    repo.findById.mockResolvedValueOnce(
      ok(createFakeAiFeedback({ userId: 'someone' })),
    )
    expectErr(
      await AiFeedbackService.remove(ACTOR, WS, 'fb_1'),
      'AI_FEEDBACK_NOT_FOUND',
    )
    repo.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await AiFeedbackService.remove(ACTOR, WS, 'fb_1'),
      'AI_FEEDBACK_NOT_FOUND',
    )
    expect(repo.delete).not.toHaveBeenCalled()
  })

  it('denies non-members and propagates errors', async () => {
    member.mockResolvedValueOnce(err(forbidden()) as never)
    expectErr(await AiFeedbackService.remove(ACTOR, WS, 'f'), 'FORBIDDEN')
    repo.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiFeedbackService.remove(ACTOR, WS, 'f'), 'DATABASE_ERROR')
    repo.findById.mockResolvedValueOnce(
      ok(createFakeAiFeedback({ userId: ACTOR })),
    )
    repo.delete.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await AiFeedbackService.remove(ACTOR, WS, 'f'), 'DATABASE_ERROR')
  })
})
