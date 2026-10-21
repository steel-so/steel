import type { WhatsAppAiCampaign } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppAiConfig } from '@/src/__tests__/factories/whatsapp-ai-config.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import {
  createFakeWhatsAppConversation,
  createFakeWhatsAppConversationWithPreview,
} from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

vi.mock('@/src/services/whatsapp-business-hours.service', () => ({
  WhatsAppBusinessHoursService: {
    check: vi.fn(async () => ({
      ok: true,
      value: { open: true, nextOpeningAt: null, hours: {} },
    })),
  },
}))
vi.mock('@/src/services/whatsapp-ai-campaign.service', () => ({
  WhatsAppAiCampaignService: { findForReply: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-ai-campaign-action.service', () => ({
  WhatsAppAiCampaignActionService: {
    run: vi.fn(async () => ({ ok: true, value: { succeeded: 1, failed: 0 } })),
  },
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
vi.mock('@/src/services/whatsapp-notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../whatsapp-notify')>()),
  notifyWhatsAppUsers: vi.fn(async () => 1),
  whatsAppAdminIds: vi.fn(async () => ['owner']),
}))

import type {
  AiChatRequest,
  AiChatResponse,
  AiProvider,
} from '@/src/lib/ai/types'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { WhatsAppAiConfigRepository } from '@/src/repositories/whatsapp-ai-config.repository'
import { WhatsAppAiKnowledgeDocumentRepository } from '@/src/repositories/whatsapp-ai-knowledge-document.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import type { AiCampaignAction } from '@/src/schemas/whatsapp-ai-campaign.schema'
import {
  AiUsageService,
  type PreparedAiCall,
} from '@/src/services/ai-usage.service'
import { WhatsAppAiCampaignService } from '@/src/services/whatsapp-ai-campaign.service'
import { WhatsAppAiCampaignActionService } from '@/src/services/whatsapp-ai-campaign-action.service'
import { WhatsAppAiReplyService } from '../whatsapp-ai-reply.service'

const CONV = 'conv1'
const actions: AiCampaignAction[] = [
  {
    id: 'a1',
    kind: 'CLOSE',
    label: 'Pagamento confirmado',
    when: 'O cliente disse que já pagou',
    statusIds: [],
  },
]
const campaign = {
  id: 'cp1',
  workspaceId: 'ws1',
  name: 'Cobrança outubro',
  objective: 'Receber as faturas',
  instructions: 'Seja cordial e nunca invente valores.',
} as WhatsAppAiCampaign

function response(
  text: string,
  toolCalls: AiChatResponse['toolCalls'] = [],
): AiChatResponse {
  return {
    text,
    toolCalls,
    message: { role: 'assistant', content: text },
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: toolCalls.length ? 'tool_use' : 'end',
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

function arrange(aiConfigActive: boolean) {
  vi.mocked(
    WhatsAppConversationRepository.findByIdWithConnection,
  ).mockResolvedValue(
    ok({
      ...createFakeWhatsAppConversation({
        id: CONV,
        workspaceId: 'ws1',
        contactId: 'contact1',
        aiActive: true,
        aiCampaignId: 'cp1',
      }),
      connection: createFakeWhatsAppConnection({ workspaceId: 'ws1' }),
    }),
  )
  vi.mocked(WhatsAppAiConfigRepository.findByWorkspace).mockResolvedValue(
    ok(
      createFakeWhatsAppAiConfig({
        workspaceId: 'ws1',
        active: aiConfigActive,
        systemPrompt: 'Prompt base.',
      }),
    ),
  )
  vi.mocked(WhatsAppAiCampaignService.findForReply).mockResolvedValue(
    ok({ campaign, actions }),
  )
  vi.mocked(
    WhatsAppMessageRepository.listLatestByConversation,
  ).mockResolvedValue(
    ok([
      createFakeWhatsAppMessage({
        id: 'm1',
        conversationId: CONV,
        text: 'Já paguei ontem',
      }),
    ]),
  )
  vi.mocked(
    WhatsAppAiKnowledgeDocumentRepository.listReadyTextsByWorkspace,
  ).mockResolvedValue(ok([]))
  vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(
    ok(createFakeWhatsAppContact({ id: 'contact1', waId: '5511988887777' })),
  )
  vi.mocked(WhatsAppMessageRepository.create).mockResolvedValue(
    ok(createFakeWhatsAppMessage({ id: 'out1', direction: 'OUT' })),
  )
  vi.mocked(WhatsAppConversationRepository.update).mockResolvedValue(
    ok(createFakeWhatsAppConversation({ id: CONV })),
  )
  vi.mocked(WhatsAppConversationRepository.findById).mockResolvedValue(
    ok(createFakeWhatsAppConversationWithPreview({ id: CONV })),
  )
  vi.mocked(WhatsAppSend.text).mockResolvedValue(
    ok({ providerMessageId: 'wamid-1' }),
  )
}

beforeEach(() => {
  vi.mocked(WhatsAppAiCampaignActionService.run).mockClear()
})

describe('WhatsAppAiReplyService.generateReply() — AI campaigns', () => {
  it('should answer a campaign conversation even with the workspace AI off, with its instructions and tools', async () => {
    arrange(false)
    const requests: AiChatRequest[] = []
    const chat = vi.fn(async (request: AiChatRequest) => {
      requests.push(structuredClone(request))
      return response('Que bom! Obrigado pelo retorno.')
    })
    vi.mocked(AiUsageService.prepare).mockResolvedValue(ok(preparedCall(chat)))

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )

    expect(outcome).toEqual(expect.objectContaining({ status: 'sent' }))
    expect(requests[0].system).toContain('## Campanha: Cobrança outubro')
    expect(requests[0].system).toContain(
      'Seja cordial e nunca invente valores.',
    )
    expect(requests[0].tools?.map((tool) => tool.name)).toContain(
      'acao_campanha_1',
    )
    expect(WhatsAppAiCampaignActionService.run).not.toHaveBeenCalled()
  })

  it('should run the action the AI chose after its reply goes out', async () => {
    arrange(true)
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        response('', [
          {
            id: 'call1',
            name: 'acao_campanha_1',
            arguments: { motivo: 'Cliente confirmou o pagamento' },
          },
        ]),
      )
      .mockResolvedValueOnce(
        response('Perfeito, obrigado! Encerrando por aqui.'),
      )
    vi.mocked(AiUsageService.prepare).mockResolvedValue(ok(preparedCall(chat)))

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )

    expect(outcome).toEqual(
      expect.objectContaining({ status: 'sent', actions: 1 }),
    )
    expect(WhatsAppSend.text).toHaveBeenCalledWith(expect.anything(), {
      to: '5511988887777',
      text: 'Perfeito, obrigado! Encerrando por aqui.',
    })
    expect(WhatsAppAiCampaignActionService.run).toHaveBeenCalledWith(
      expect.objectContaining({ campaign }),
      [
        {
          action: actions[0],
          reason: 'Cliente confirmou o pagamento',
          fields: {},
        },
      ],
    )
    // The tool result tells the model the action waits for its reply.
    const secondCall = chat.mock.calls[1][0] as AiChatRequest
    expect(secondCall.toolChoice).toBe('none')
    expect(JSON.stringify(secondCall.messages)).toContain('Ação registrada')
  })

  it('should still run the action when the AI writes nothing', async () => {
    arrange(true)
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        response('', [
          {
            id: 'call1',
            name: 'acao_campanha_1',
            arguments: { motivo: 'Já pagou' },
          },
        ]),
      )
      .mockResolvedValueOnce(response(''))
    vi.mocked(AiUsageService.prepare).mockResolvedValue(ok(preparedCall(chat)))

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )

    expect(outcome).toEqual({ status: 'skipped', reason: 'empty_completion' })
    expect(WhatsAppSend.text).not.toHaveBeenCalled()
    expect(WhatsAppAiCampaignActionService.run).toHaveBeenCalledTimes(1)
  })

  it('should fall back to the workspace AI rules for an archived campaign', async () => {
    arrange(false)
    vi.mocked(WhatsAppAiCampaignService.findForReply).mockResolvedValue(
      ok(null),
    )

    const outcome = expectOk(
      await WhatsAppAiReplyService.generateReply({
        conversationId: CONV,
        messageId: 'm1',
      }),
    )

    expect(outcome).toEqual({ status: 'skipped', reason: 'ai_config_inactive' })
  })
})
