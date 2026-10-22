import { describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppAiConfig } from '@/src/__tests__/factories/whatsapp-ai-config.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import {
  createFakeWhatsAppConversation,
  createFakeWhatsAppConversationWithPreview,
} from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

// Business hours: open unless a test says otherwise.
vi.mock('@/src/services/whatsapp-business-hours.service', () => ({
  WhatsAppBusinessHoursService: {
    assertOpen: vi.fn(async () => ({ ok: true, value: undefined })),
    check: vi.fn(async () => ({
      ok: true,
      value: { open: true, nextOpeningAt: null, hours: {} },
    })),
  },
}))
vi.mock('@/src/services/whatsapp-sla.service', () => ({
  WhatsAppSlaService: { onOutbound: vi.fn(async () => undefined) },
}))
vi.mock('@/src/repositories/whatsapp-ai-config.repository')
vi.mock('@/src/repositories/whatsapp-ai-knowledge-document.repository')
vi.mock('@/src/repositories/whatsapp-broadcast.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/whatsapp-conversation-event.repository')
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/services/whatsapp-distribution.service', () => ({
  WhatsAppDistributionService: {
    distributeConversation: vi.fn(async () => ({
      ok: true,
      value: { assigned: false, reason: 'disabled' },
    })),
  },
}))
vi.mock('@/src/services/whatsapp-notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../whatsapp-notify')>()),
  notifyWhatsAppUsers: vi.fn(async () => 1),
  whatsAppAdminIds: vi.fn(async () => ['owner', 'admin']),
}))

import { auditMutation } from '@/lib/axiom/audit'
import {
  aiProviderUnavailable,
  aiQuotaExceeded,
  databaseError,
} from '@/src/errors'
import type { AiChatResponse, AiProvider } from '@/src/lib/ai/types'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { WhatsAppAiConfigRepository } from '@/src/repositories/whatsapp-ai-config.repository'
import { WhatsAppAiKnowledgeDocumentRepository } from '@/src/repositories/whatsapp-ai-knowledge-document.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import {
  AiUsageService,
  type PreparedAiCall,
} from '@/src/services/ai-usage.service'
import { WhatsAppBusinessHoursService } from '@/src/services/whatsapp-business-hours.service'
import { WhatsAppSlaService } from '@/src/services/whatsapp-sla.service'
import { WhatsAppAiReplyService } from '../whatsapp-ai-reply.service'
import { WhatsAppDistributionService } from '../whatsapp-distribution.service'
import { notifyWhatsAppUsers, whatsAppAdminIds } from '../whatsapp-notify'

const mockedConversationRepo = vi.mocked(WhatsAppConversationRepository)
const mockedAiConfigRepo = vi.mocked(WhatsAppAiConfigRepository)
const mockedKnowledgeRepo = vi.mocked(WhatsAppAiKnowledgeDocumentRepository)
const mockedContactRepo = vi.mocked(WhatsAppContactRepository)
const mockedMessageRepo = vi.mocked(WhatsAppMessageRepository)
const mockedAiUsage = vi.mocked(AiUsageService)
const mockedSend = vi.mocked(WhatsAppSend)

const WS = 'ws1'
const CONV = 'conv1'

function response(text: string): AiChatResponse {
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant', content: text },
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: 'end',
  }
}

function preparedCall(chat: AiProvider['chat']): PreparedAiCall {
  return {
    feature: 'WHATSAPP_REPLY',
    provider: { id: 'openai', chat, chatStream: vi.fn() },
    model: {
      key: 'openai:gpt-4o-mini',
      provider: 'openai',
      model: 'gpt-4o-mini',
      label: 'GPT-4o mini',
    },
    usdPer1kTokens: 4,
  }
}

function arrange(options?: {
  conversation?: Parameters<typeof createFakeWhatsAppConversation>[0]
  aiConfigActive?: boolean
}) {
  const connection = createFakeWhatsAppConnection({ workspaceId: WS })
  const conversation = {
    ...createFakeWhatsAppConversation({
      id: CONV,
      workspaceId: WS,
      contactId: 'contact1',
      aiActive: true,
      ...options?.conversation,
    }),
    connection,
  }
  mockedConversationRepo.findByIdWithConnection.mockResolvedValue(
    ok(conversation),
  )
  mockedAiConfigRepo.findByWorkspace.mockResolvedValue(
    ok(
      createFakeWhatsAppAiConfig({
        workspaceId: WS,
        active: options?.aiConfigActive ?? true,
        systemPrompt: 'Prompt base.',
      }),
    ),
  )
  mockedMessageRepo.listLatestByConversation.mockResolvedValue(
    ok([
      createFakeWhatsAppMessage({
        id: 'm1',
        conversationId: CONV,
        text: 'Oi',
      }),
    ]),
  )
  mockedKnowledgeRepo.listReadyTextsByWorkspace.mockResolvedValue(ok([]))
  mockedContactRepo.findById.mockResolvedValue(
    ok(createFakeWhatsAppContact({ id: 'contact1', waId: '5511988887777' })),
  )
  mockedMessageRepo.create.mockImplementation(async (data) =>
    ok(
      createFakeWhatsAppMessage({
        id: 'out1',
        conversationId: CONV,
        direction: 'OUT',
        text: data.text ?? null,
      }),
    ),
  )
  mockedConversationRepo.update.mockResolvedValue(
    ok(createFakeWhatsAppConversation({ id: CONV })),
  )
  mockedConversationRepo.findById.mockResolvedValue(
    ok(createFakeWhatsAppConversationWithPreview({ id: CONV })),
  )
  mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'wamid-1' }))
  return { connection, conversation }
}

describe('WhatsAppAiReplyService.generateReply()', () => {
  it('should skip when the conversation does not exist', async () => {
    mockedConversationRepo.findByIdWithConnection.mockResolvedValue(ok(null))

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )
    expect(outcome).toEqual({
      status: 'skipped',
      reason: 'conversation_not_found',
    })
  })

  it('should skip when AI is inactive on the conversation', async () => {
    arrange({ conversation: { aiActive: false } })

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )
    expect(outcome).toEqual({ status: 'skipped', reason: 'ai_inactive' })
    expect(mockedAiUsage.prepare).not.toHaveBeenCalled()
  })

  it('should not reply on a closed conversation until it is reopened', async () => {
    arrange({ conversation: { status: 'CLOSED' } })

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )
    expect(outcome).toEqual({
      status: 'skipped',
      reason: 'conversation_closed',
    })
    expect(mockedAiUsage.prepare).not.toHaveBeenCalled()
    expect(mockedSend.text).not.toHaveBeenCalled()
  })

  it('should defer the answer to the opening outside business hours', async () => {
    arrange({})
    const opening = new Date('2026-10-21T11:00:00Z')
    vi.mocked(WhatsAppBusinessHoursService.check).mockResolvedValueOnce(
      ok({
        open: false,
        nextOpeningAt: opening,
        hours: { enabled: true, start: '08:00', end: '18:00', days: [1] },
      }),
    )

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )
    expect(outcome).toEqual({ status: 'deferred', retryAt: opening })
    expect(mockedAiUsage.prepare).not.toHaveBeenCalled()
    expect(mockedSend.text).not.toHaveBeenCalled()
  })

  it('should skip when the workspace AI config is inactive', async () => {
    arrange({ aiConfigActive: false })

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )
    expect(outcome).toEqual({ status: 'skipped', reason: 'ai_config_inactive' })
  })

  it('should skip with ai_quota_exceeded when the quota is exhausted', async () => {
    arrange()
    mockedAiUsage.prepare.mockResolvedValue(err(aiQuotaExceeded(10, 10)))

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )
    expect(outcome).toEqual({ status: 'skipped', reason: 'ai_quota_exceeded' })
    expect(mockedSend.text).not.toHaveBeenCalled()
  })

  it('should skip with ai_provider_unavailable when no provider is configured', async () => {
    arrange()
    mockedAiUsage.prepare.mockResolvedValue(err(aiProviderUnavailable()))

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )
    expect(outcome).toEqual({
      status: 'skipped',
      reason: 'ai_provider_unavailable',
    })
  })

  it('should send the reply, persist it as sentByAi and record usage', async () => {
    const { connection } = arrange()
    const chat = vi.fn(async () => response('Olá! Como posso ajudar?'))
    mockedAiUsage.prepare.mockResolvedValue(ok(preparedCall(chat)))

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )

    expect(outcome).toEqual({
      status: 'sent',
      messageId: 'out1',
      handoff: false,
    })
    expect(mockedAiUsage.prepare).toHaveBeenCalledWith(WS, 'WHATSAPP_REPLY')
    expect(mockedSend.text).toHaveBeenCalledWith(
      connection,
      { to: '5511988887777', text: 'Olá! Como posso ajudar?' },
      { cost: { source: 'AI_REPLY', conversationId: CONV } },
    )
    expect(mockedMessageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'OUT',
        sentByAi: true,
        providerMessageId: 'wamid-1',
      }),
    )
    expect(mockedAiUsage.record).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: WS,
      userId: null,
      usage: { inputTokens: 10, outputTokens: 5 },
    })
    expect(auditMutation).not.toHaveBeenCalled()
    // Reported as an AI answer: the SLA counts it only if the policy says so.
    expect(WhatsAppSlaService.onOutbound).toHaveBeenCalledWith({
      workspaceId: WS,
      conversationId: CONV,
      senderUserId: null,
      byAi: true,
    })
  })

  it('answers a button AI instruction even with the AI off', async () => {
    arrange({ conversation: { aiActive: false }, aiConfigActive: false })
    const chat = vi.fn(async () => response('Temos o plano Pro!'))
    mockedAiUsage.prepare.mockResolvedValue(ok(preparedCall(chat)))

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
        instruction: 'Ofereça o plano Pro',
      }),
    )

    expect(outcome).toMatchObject({ status: 'sent' })
    const call = (chat.mock.calls[0] as unknown as [{ system: string }])[0]
    expect(call.system).toContain('Prompt base.')
    expect(call.system).toContain(
      'Instrução para esta resposta (o cliente clicou num botão): Ofereça o plano Pro',
    )
  })

  it('answers a button AI instruction without any AI config', async () => {
    arrange()
    mockedAiConfigRepo.findByWorkspace.mockResolvedValue(ok(null))
    const chat = vi.fn(async () => response('Claro!'))
    mockedAiUsage.prepare.mockResolvedValue(ok(preparedCall(chat)))

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
        instruction: 'Seja breve',
      }),
    )

    expect(outcome).toMatchObject({ status: 'sent' })
    const call = (chat.mock.calls[0] as unknown as [{ system: string }])[0]
    expect(call.system.startsWith('\n\nSe o cliente pedir')).toBe(true)
  })

  it('should hand off to a human when the marker is present', async () => {
    arrange()
    const chat = vi.fn(async () =>
      response('Um momento. [[TRANSFERIR_ATENDENTE]]'),
    )
    mockedAiUsage.prepare.mockResolvedValue(ok(preparedCall(chat)))

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )

    expect(outcome).toEqual(
      expect.objectContaining({ status: 'sent', handoff: true }),
    )
    expect(mockedSend.text).toHaveBeenCalledWith(
      expect.anything(),
      { to: '5511988887777', text: 'Um momento.' },
      { cost: { source: 'AI_REPLY', conversationId: CONV } },
    )
    expect(mockedConversationRepo.update).toHaveBeenCalledWith(
      CONV,
      expect.objectContaining({
        aiActive: false,
        aiHandoff: true,
        status: 'IN_PROGRESS',
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_conversation',
        actorId: null,
        targetId: CONV,
      }),
    )
  })

  it('should report provider_failed and still record usage when the AI call throws', async () => {
    arrange()
    const chat = vi.fn(async () => {
      throw new Error('boom')
    })
    mockedAiUsage.prepare.mockResolvedValue(ok(preparedCall(chat)))

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )

    expect(outcome).toEqual(
      expect.objectContaining({
        status: 'failed',
        reason: 'provider_failed',
        detail: 'boom',
      }),
    )
    expect(mockedAiUsage.record).toHaveBeenCalled()
    expect(mockedSend.text).not.toHaveBeenCalled()
  })

  it('should skip with empty_completion when the model returns no text', async () => {
    arrange()
    mockedAiUsage.prepare.mockResolvedValue(
      ok(preparedCall(vi.fn(async () => response('   ')))),
    )

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )
    expect(outcome).toEqual({ status: 'skipped', reason: 'empty_completion' })
  })

  it('should report send_failed without persisting when the provider send fails', async () => {
    arrange()
    mockedAiUsage.prepare.mockResolvedValue(
      ok(preparedCall(vi.fn(async () => response('Oi!')))),
    )
    mockedSend.text.mockResolvedValue(
      err({ code: 'WHATSAPP_PROVIDER_ERROR', message: 'down' }),
    )

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )
    expect(outcome).toEqual(
      expect.objectContaining({ status: 'failed', reason: 'send_failed' }),
    )
    expect(mockedMessageRepo.create).not.toHaveBeenCalled()
  })

  it('should propagate database errors', async () => {
    mockedConversationRepo.findByIdWithConnection.mockResolvedValue(
      err(databaseError('db down')),
    )

    expectErr(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppAiReplyService · handoff notice', () => {
  const notify = vi.mocked(notifyWhatsAppUsers)
  const admins = vi.mocked(whatsAppAdminIds)

  function handoff(conversation = {}) {
    arrange({ conversation })
    mockedAiUsage.prepare.mockResolvedValue(
      ok(
        preparedCall(
          vi.fn(async () => response('Um momento. [[TRANSFERIR_ATENDENTE]]')),
        ),
      ),
    )
    return WhatsAppAiReplyService.generateReply({
      conversationId: CONV,
      messageId: 'm1',
    })
  }

  it('tells the assignee when the AI hands the conversation over', async () => {
    expectOk(await handoff({ assignedUserId: 'agent' }))
    expect(admins).not.toHaveBeenCalled()
    const [input] = notify.mock.calls[0]
    expect(input).toMatchObject({
      workspaceId: WS,
      kind: 'WHATSAPP_AI_HANDOFF',
      userIds: ['agent'],
      title: 'A IA transferiu uma conversa para você',
    })
    expect(input.body).toContain('precisa de um atendente')
    expect(input.path).toBe(`/zap?conversa=${CONV}`)
  })

  it('falls back to the capped module admins without an assignee', async () => {
    expectOk(await handoff({ assignedUserId: null }))
    expect(admins).toHaveBeenCalledWith(WS)
    expect(notify.mock.calls[0][0].userIds).toEqual(['owner', 'admin'])
  })

  it('tells the team of an unassigned team conversation (Equipes)', async () => {
    vi.mocked(
      WhatsAppTeamRepository.listMembershipSnapshot,
    ).mockResolvedValueOnce(
      ok([
        {
          id: 'team1',
          members: [
            { userId: 'lia', role: 'LEADER' },
            { userId: 'ana', role: 'AGENT' },
          ],
        },
      ]),
    )
    expectOk(await handoff({ assignedUserId: null, teamId: 'team1' }))
    expect(admins).not.toHaveBeenCalled()
    expect(notify.mock.calls[0][0].userIds).toEqual(['lia', 'ana'])
  })

  it('offers an unassigned handoff to the automatic distribution and starts the queue clock', async () => {
    expectOk(await handoff({ assignedUserId: null }))
    expect(
      WhatsAppDistributionService.distributeConversation,
    ).toHaveBeenCalledWith(WS, CONV)
    expect(mockedConversationRepo.update).toHaveBeenCalledWith(
      CONV,
      expect.objectContaining({
        aiHandoff: true,
        queuedAt: expect.any(Date),
        unassignedReminderAt: null,
      }),
    )
  })

  it('lets the agent the distribution picked hear about it instead of the usual handoff notice', async () => {
    vi.mocked(
      WhatsAppDistributionService.distributeConversation,
    ).mockResolvedValueOnce({
      ok: true,
      value: { assigned: true, userId: 'ana' },
    })
    expectOk(await handoff({ assignedUserId: null }))
    expect(notify).not.toHaveBeenCalled()
  })

  it('does not distribute when the conversation already has an assignee', async () => {
    vi.mocked(WhatsAppDistributionService.distributeConversation).mockClear()
    expectOk(await handoff({ assignedUserId: 'agent' }))
    expect(
      WhatsAppDistributionService.distributeConversation,
    ).not.toHaveBeenCalled()
    expect(mockedConversationRepo.update).toHaveBeenCalledWith(
      CONV,
      expect.not.objectContaining({ queuedAt: expect.anything() }),
    )
  })

  it('never notifies a regular AI reply', async () => {
    arrange()
    mockedAiUsage.prepare.mockResolvedValue(
      ok(preparedCall(vi.fn(async () => response('Claro, posso ajudar.')))),
    )
    expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('WhatsAppAiReplyService.generateReply() — guardrails (ADR 0041)', () => {
  const events = vi.mocked(WhatsAppConversationEventRepository)
  const limits = {
    forbiddenTopics: ['processo judicial'],
    maxDiscountPercent: 10,
    maxRefundAmount: null,
    maxDeadlineDays: null,
  }
  function guardedCall(
    chat: AiProvider['chat'],
    tainted = false,
  ): PreparedAiCall {
    return {
      ...preparedCall(chat),
      guardrails: {
        piiMaskingPolicy: 'AUTO_REPLIES',
        injectionClassifierEnabled: false,
        limits,
      },
      guard: {
        report: {
          piiCounts: { EMAIL: 0, CNPJ: 0, CPF: 0, CARD: 0, PHONE: 0 },
          injection: { detected: tainted, signals: [], sources: [] },
          failovers: [],
        },
        tainted: () => tainted,
      },
    }
  }

  it('should tell the model the limits and drop a draft beyond them', async () => {
    arrange()
    events.create.mockResolvedValue(ok({} as never))
    const chat = vi.fn<AiProvider['chat']>(async () =>
      response('Te dou 30% de desconto!'),
    )
    mockedAiUsage.prepare.mockResolvedValue(ok(guardedCall(chat)))

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )

    expect(chat.mock.calls[0][0].system).toContain('Limites de alçada')
    expect(outcome).toEqual(
      expect.objectContaining({
        status: 'sent',
        handoff: true,
        guardrail: 'discount',
      }),
    )
    // The customer never sees the draft.
    expect(mockedSend.text).toHaveBeenCalledWith(
      expect.anything(),
      {
        to: '5511988887777',
        text: 'Vou te transferir para um de nossos atendentes, só um momento.',
      },
      { cost: { source: 'AI_REPLY', conversationId: CONV } },
    )
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'AI_GUARDRAIL_HANDOFF',
        source: 'AI_GUARDRAIL',
        reason: expect.stringContaining('10%'),
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'ai_guardrail',
        action: 'escalate',
        meta: expect.objectContaining({ kind: 'discount' }),
      }),
    )
    expect(
      vi.mocked(notifyWhatsAppUsers).mock.calls.at(-1)?.[0].body,
    ).toContain('10%')
  })

  it('should hand off when the customer touches a forbidden topic, even if the event write fails', async () => {
    arrange()
    mockedMessageRepo.listLatestByConversation.mockResolvedValue(
      ok([
        createFakeWhatsAppMessage({
          id: 'm1',
          conversationId: CONV,
          text: 'Vou abrir um processo judicial',
        }),
      ]),
    )
    events.create.mockResolvedValue(err(databaseError()))
    mockedAiUsage.prepare.mockResolvedValue(
      ok(guardedCall(vi.fn(async () => response('Entendo, posso ajudar.')))),
    )
    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )
    expect(outcome).toMatchObject({ guardrail: 'forbidden_topic' })
    expect(mockedConversationRepo.update).toHaveBeenCalledWith(
      CONV,
      expect.objectContaining({ aiHandoff: true }),
    )
  })

  it('should hand off when the call saw a prompt injection', async () => {
    arrange()
    events.create.mockResolvedValue(ok({} as never))
    mockedAiUsage.prepare.mockResolvedValue(
      ok(
        guardedCall(
          vi.fn(async () => response('Tudo liberado!')),
          true,
        ),
      ),
    )
    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )
    expect(outcome).toMatchObject({ guardrail: 'prompt_injection' })
  })

  it('should send a draft within the limits as usual', async () => {
    arrange()
    mockedAiUsage.prepare.mockResolvedValue(
      ok(guardedCall(vi.fn(async () => response('Consigo 5% de desconto.')))),
    )
    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )
    expect(outcome).toEqual({
      status: 'sent',
      messageId: 'out1',
      handoff: false,
    })
  })
})
