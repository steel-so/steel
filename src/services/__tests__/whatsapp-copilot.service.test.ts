import { describe, expect, it, vi } from 'vitest'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
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
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
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
    usage: { inputTokens: 10, outputTokens: 5 },
  } as AiChatResponse
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
