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

vi.mock('@/src/repositories/whatsapp-ai-config.repository')
vi.mock('@/src/repositories/whatsapp-ai-knowledge-document.repository')
vi.mock('@/src/repositories/whatsapp-broadcast.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
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
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import {
  AiUsageService,
  type PreparedAiCall,
} from '@/src/services/ai-usage.service'
import { WhatsAppAiReplyService } from '../whatsapp-ai-reply.service'
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
    expect(mockedSend.text).toHaveBeenCalledWith(connection, {
      to: '5511988887777',
      text: 'Olá! Como posso ajudar?',
    })
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
    expect(mockedSend.text).toHaveBeenCalledWith(expect.anything(), {
      to: '5511988887777',
      text: 'Um momento.',
    })
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
