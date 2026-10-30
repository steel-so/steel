import { describe, expect, it, vi } from 'vitest'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-conversation-event.repository')
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(),
}))
vi.mock('@/src/mappers/whatsapp-conversation.mapper', () => ({
  toWhatsAppConversationDTO: vi.fn(() => ({ id: 'conv1' })),
}))
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/services/authz')
vi.mock('@/src/services/whatsapp-conversation-scope.service')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import {
  aiQuotaExceeded,
  databaseError,
  forbidden,
  whatsappConversationNotFound,
} from '@/src/errors'
import type { AiChatResponse, AiProvider } from '@/src/lib/ai/types'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import {
  AiUsageService,
  type PreparedAiCall,
} from '@/src/services/ai-usage.service'
import { assertModuleMember } from '@/src/services/authz'
import {
  loadVisibleConversation,
  resolveConversationScope,
} from '@/src/services/whatsapp-conversation-scope.service'
import { WhatsAppCopilotService } from '../whatsapp-copilot.service'

const mockedMessages = vi.mocked(WhatsAppMessageRepository)
const mockedUsers = vi.mocked(UserRepository)
const mockedAiUsage = vi.mocked(AiUsageService)
const mockedMember = vi.mocked(assertModuleMember)
const mockedScope = vi.mocked(resolveConversationScope)
const mockedLoad = vi.mocked(loadVisibleConversation)

function response(text: string): AiChatResponse {
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant', content: text },
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: 'end_turn',
  } as unknown as AiChatResponse
}

function prepared(chat: AiProvider['chat']): PreparedAiCall {
  return {
    feature: 'WHATSAPP_REPLY',
    provider: { id: 'openai', chat, chatStream: vi.fn() },
    model: {
      key: 'openai:gpt-4o-mini',
      provider: 'openai',
      model: 'gpt-4o-mini',
      label: 'GPT-4o mini',
    },
  } as PreparedAiCall
}

function setup(options: { chat?: AiProvider['chat']; clearedAt?: Date } = {}) {
  vi.clearAllMocks()
  mockedMember.mockResolvedValue(ok({ role: 'MEMBER' } as never))
  mockedScope.mockResolvedValue(ok({} as never))
  mockedLoad.mockResolvedValue(
    ok(
      createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        workspaceId: 'ws1',
        clearedAt: options.clearedAt ?? null,
      }),
    ),
  )
  mockedUsers.findById.mockResolvedValue(ok(createFakeUser({ name: 'João' })))
  mockedMessages.listLatestByConversation.mockResolvedValue(
    ok([
      createFakeWhatsAppMessage({ text: 'Quero reagendar' }),
      createFakeWhatsAppMessage({ text: 'Bom dia' }),
    ]),
  )
  const chat = options.chat ?? vi.fn().mockResolvedValue(response('Claro!'))
  mockedAiUsage.prepare.mockResolvedValue(ok(prepared(chat)))
  mockedAiUsage.record.mockResolvedValue(undefined)
  return chat
}

describe('WhatsAppCopilotService.suggestReply', () => {
  it('returns the cleaned suggestion, records usage and audits', async () => {
    const chat = setup({
      chat: vi.fn().mockResolvedValue(response('"Claro, vamos reagendar!"')),
    })

    const result = expectOk(
      await WhatsAppCopilotService.suggestReply('u1', 'ws1', 'conv1', {
        hint: 'ofereça reagendar',
      }),
    )

    expect(result.text).toBe('Claro, vamos reagendar!')
    const call = vi.mocked(chat).mock.calls[0][0]
    expect(call.system).toContain('ofereça reagendar')
    expect(call.system).toContain('João')
    expect(mockedAiUsage.prepare).toHaveBeenCalledWith(
      'ws1',
      'WHATSAPP_REPLY',
      'u1',
    )
    expect(mockedAiUsage.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'u1', workspaceId: 'ws1' }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { copilot: 'suggest' } }),
    )
  })

  it('works without the agent name when the user lookup fails', async () => {
    setup()
    mockedUsers.findById.mockResolvedValue(err(databaseError('x')))
    expectOk(
      await WhatsAppCopilotService.suggestReply('u1', 'ws1', 'conv1', {}),
    )
  })

  it('ignores messages from before the history was cleared', async () => {
    setup({ clearedAt: new Date(Date.now() + 60_000) })
    expectErr(
      await WhatsAppCopilotService.suggestReply('u1', 'ws1', 'conv1', {}),
      'WHATSAPP_COPILOT_NO_CONTEXT',
    )
  })

  it('fails with NO_CONTEXT when the conversation is empty', async () => {
    setup()
    mockedMessages.listLatestByConversation.mockResolvedValue(ok([]))
    expectErr(
      await WhatsAppCopilotService.suggestReply('u1', 'ws1', 'conv1', {}),
      'WHATSAPP_COPILOT_NO_CONTEXT',
    )
    expect(mockedAiUsage.prepare).not.toHaveBeenCalled()
  })

  it('propagates a history read error', async () => {
    setup()
    mockedMessages.listLatestByConversation.mockResolvedValue(
      err(databaseError('x')),
    )
    expectErr(
      await WhatsAppCopilotService.suggestReply('u1', 'ws1', 'conv1', {}),
      'DATABASE_ERROR',
    )
  })

  it('maps provider failures to WHATSAPP_COPILOT_FAILED', async () => {
    setup({ chat: vi.fn().mockRejectedValue(new Error('boom')) })
    expectErr(
      await WhatsAppCopilotService.suggestReply('u1', 'ws1', 'conv1', {}),
      'WHATSAPP_COPILOT_FAILED',
    )
    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('fails when the model returns nothing usable', async () => {
    setup({ chat: vi.fn().mockResolvedValue(response('  ')) })
    expectErr(
      await WhatsAppCopilotService.suggestReply('u1', 'ws1', 'conv1', {}),
      'WHATSAPP_COPILOT_FAILED',
    )
  })

  it('propagates quota errors', async () => {
    setup()
    mockedAiUsage.prepare.mockResolvedValue(err(aiQuotaExceeded(10, 5)))
    expectErr(
      await WhatsAppCopilotService.suggestReply('u1', 'ws1', 'conv1', {}),
      'AI_QUOTA_EXCEEDED',
    )
  })

  it('denies non-members and viewers', async () => {
    setup()
    mockedMember.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppCopilotService.suggestReply('u1', 'ws1', 'conv1', {}),
      'FORBIDDEN',
    )
    expect(mockedMessages.listLatestByConversation).not.toHaveBeenCalled()
  })

  it('propagates scope errors', async () => {
    setup()
    mockedScope.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppCopilotService.suggestReply('u1', 'ws1', 'conv1', {}),
      'DATABASE_ERROR',
    )
  })

  it('answers 404 for a conversation the actor cannot see', async () => {
    setup()
    mockedLoad.mockResolvedValue(err(whatsappConversationNotFound()))
    expectErr(
      await WhatsAppCopilotService.suggestReply('u1', 'ws1', 'conv1', {}),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
  })
})

describe('WhatsAppCopilotService.summarize', () => {
  it('returns summary and pending items', async () => {
    setup({
      chat: vi
        .fn()
        .mockResolvedValue(
          response(
            JSON.stringify({ summary: 'Reagendamento', pending: ['x'] }),
          ),
        ),
    })
    const result = expectOk(
      await WhatsAppCopilotService.summarize('u1', 'ws1', 'conv1'),
    )
    expect(result).toEqual({ summary: 'Reagendamento', pending: ['x'] })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { copilot: 'summary' } }),
    )
  })

  it('fails on an unparseable answer', async () => {
    setup({ chat: vi.fn().mockResolvedValue(response('texto solto')) })
    expectErr(
      await WhatsAppCopilotService.summarize('u1', 'ws1', 'conv1'),
      'WHATSAPP_COPILOT_FAILED',
    )
  })

  it('propagates authorization errors', async () => {
    setup()
    mockedMember.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppCopilotService.summarize('u1', 'ws1', 'conv1'),
      'FORBIDDEN',
    )
  })

  it('fails with NO_CONTEXT on an empty conversation', async () => {
    setup()
    mockedMessages.listLatestByConversation.mockResolvedValue(ok([]))
    expectErr(
      await WhatsAppCopilotService.summarize('u1', 'ws1', 'conv1'),
      'WHATSAPP_COPILOT_NO_CONTEXT',
    )
  })
})

describe('WhatsAppCopilotService.adjustTone', () => {
  it('rewrites the draft in the requested tone', async () => {
    const chat = setup({
      chat: vi.fn().mockResolvedValue(response('Prezado cliente, ok.')),
    })
    const result = expectOk(
      await WhatsAppCopilotService.adjustTone('u1', 'ws1', 'conv1', {
        text: 'ok',
        tone: 'FORMAL',
      }),
    )
    expect(result.text).toBe('Prezado cliente, ok.')
    const call = vi.mocked(chat).mock.calls[0][0]
    expect(call.system).toContain('formal')
    expect(String(call.messages[0].content)).toContain('untrusted_content')
    expect(mockedMessages.listLatestByConversation).not.toHaveBeenCalled()
  })

  it('fails when the model returns an empty rewrite', async () => {
    setup({ chat: vi.fn().mockResolvedValue(response('')) })
    expectErr(
      await WhatsAppCopilotService.adjustTone('u1', 'ws1', 'conv1', {
        text: 'ok',
        tone: 'DIRECT',
      }),
      'WHATSAPP_COPILOT_FAILED',
    )
  })

  it('propagates authorization errors', async () => {
    setup()
    mockedMember.mockResolvedValue(err(forbidden()))
    expectErr(
      await WhatsAppCopilotService.adjustTone('u1', 'ws1', 'conv1', {
        text: 'ok',
        tone: 'DIRECT',
      }),
      'FORBIDDEN',
    )
  })

  it('propagates quota errors', async () => {
    setup()
    mockedAiUsage.prepare.mockResolvedValue(err(aiQuotaExceeded(10, 5)))
    expectErr(
      await WhatsAppCopilotService.adjustTone('u1', 'ws1', 'conv1', {
        text: 'ok',
        tone: 'FIX_ONLY',
      }),
      'AI_QUOTA_EXCEEDED',
    )
  })
})

describe('WhatsAppCopilotService.summarizeOnTransfer', () => {
  const input = { actorId: 'u1', workspaceId: 'ws1', conversationId: 'conv1' }
  const summaryJson = JSON.stringify({
    summary: 'Cliente quer reagendar.',
    pending: ['Confirmar horário'],
  })

  function setupTransfer(
    options: { enabled?: boolean; chat?: AiProvider['chat'] } = {},
  ) {
    const chat =
      options.chat ?? vi.fn().mockResolvedValue(response(summaryJson))
    setup({ chat })
    vi.mocked(WhatsAppSettingsRepository.findByWorkspace).mockResolvedValue(
      ok({ copilotSummaryOnTransfer: options.enabled ?? true } as never),
    )
    vi.mocked(WhatsAppConversationRepository.findById).mockResolvedValue(
      ok(
        createFakeWhatsAppConversationWithPreview({
          id: 'conv1',
          workspaceId: 'ws1',
        }) as never,
      ),
    )
    vi.mocked(WhatsAppConversationEventRepository.create).mockResolvedValue(
      ok({} as never),
    )
    return chat
  }

  it('writes the summary on the timeline, uses the quota and audits', async () => {
    const chat = setupTransfer()
    const result = expectOk(
      await WhatsAppCopilotService.summarizeOnTransfer(input),
    )
    expect(result).toEqual({ written: true })
    expect(chat).toHaveBeenCalledTimes(1)
    expect(mockedAiUsage.prepare).toHaveBeenCalledWith(
      'ws1',
      'WHATSAPP_REPLY',
      'u1',
    )
    expect(WhatsAppConversationEventRepository.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      conversationId: 'conv1',
      kind: 'TRANSFER_SUMMARY',
      source: 'COPILOT',
      actorUserId: 'u1',
      reason: 'Cliente quer reagendar.\n\nPendente:\n- Confirmar horário',
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: { copilot: 'summary', via: 'transfer' },
      }),
    )
    expect(publishWhatsAppEvent).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ type: 'conversation.updated' }),
    )
  })

  it('does nothing when the setting is off or was never saved', async () => {
    const chat = setupTransfer({ enabled: false })
    expect(
      expectOk(await WhatsAppCopilotService.summarizeOnTransfer(input)),
    ).toEqual({ written: false, reason: 'disabled' })
    vi.mocked(WhatsAppSettingsRepository.findByWorkspace).mockResolvedValue(
      ok(null),
    )
    expect(
      expectOk(await WhatsAppCopilotService.summarizeOnTransfer(input)),
    ).toEqual({ written: false, reason: 'disabled' })
    expect(chat).not.toHaveBeenCalled()
    expect(mockedAiUsage.prepare).not.toHaveBeenCalled()
  })

  it('skips a missing or deleted conversation', async () => {
    setupTransfer()
    vi.mocked(WhatsAppConversationRepository.findById).mockResolvedValue(
      ok(null),
    )
    expect(
      expectOk(await WhatsAppCopilotService.summarizeOnTransfer(input)),
    ).toEqual({ written: false, reason: 'conversation_missing' })
    vi.mocked(WhatsAppConversationRepository.findById).mockResolvedValue(
      ok({ deletedAt: new Date() } as never),
    )
    expect(
      expectOk(await WhatsAppCopilotService.summarizeOnTransfer(input)),
    ).toEqual({ written: false, reason: 'conversation_missing' })
  })

  it('returns the quota error without writing anything', async () => {
    setupTransfer()
    mockedAiUsage.prepare.mockResolvedValue(err(aiQuotaExceeded(10, 10)))
    expectErr(
      await WhatsAppCopilotService.summarizeOnTransfer(input),
      'AI_QUOTA_EXCEEDED',
    )
    expect(WhatsAppConversationEventRepository.create).not.toHaveBeenCalled()
  })

  it('fails on an unparseable answer, an empty conversation and database errors', async () => {
    setupTransfer({ chat: vi.fn().mockResolvedValue(response('solto')) })
    expectErr(
      await WhatsAppCopilotService.summarizeOnTransfer(input),
      'WHATSAPP_COPILOT_FAILED',
    )

    setupTransfer()
    mockedMessages.listLatestByConversation.mockResolvedValue(ok([]))
    expectErr(
      await WhatsAppCopilotService.summarizeOnTransfer(input),
      'WHATSAPP_COPILOT_NO_CONTEXT',
    )

    setupTransfer()
    vi.mocked(WhatsAppSettingsRepository.findByWorkspace).mockResolvedValue(
      err(databaseError('x')),
    )
    expectErr(
      await WhatsAppCopilotService.summarizeOnTransfer(input),
      'DATABASE_ERROR',
    )

    setupTransfer()
    vi.mocked(WhatsAppConversationRepository.findById).mockResolvedValue(
      err(databaseError('x')),
    )
    expectErr(
      await WhatsAppCopilotService.summarizeOnTransfer(input),
      'DATABASE_ERROR',
    )

    setupTransfer()
    vi.mocked(WhatsAppConversationEventRepository.create).mockResolvedValue(
      err(databaseError('x')),
    )
    expectErr(
      await WhatsAppCopilotService.summarizeOnTransfer(input),
      'DATABASE_ERROR',
    )
  })

  it('does not publish when the conversation cannot be reloaded', async () => {
    setupTransfer()
    vi.mocked(WhatsAppConversationRepository.findById)
      .mockResolvedValueOnce(
        ok(createFakeWhatsAppConversationWithPreview() as never),
      )
      .mockResolvedValueOnce(ok(null))
    expectOk(await WhatsAppCopilotService.summarizeOnTransfer(input))
    expect(publishWhatsAppEvent).not.toHaveBeenCalled()
  })
})
