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
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

// Fire-and-forget webhook: the real emitter would outlive the test.
vi.mock('@/src/services/whatsapp-conversation-waiting', () => ({
  emitWhatsAppConversationWaiting: vi.fn(),
}))
vi.mock('@/src/services/whatsapp-usage.service', () => ({
  WhatsAppUsageService: { record: vi.fn(async () => undefined) },
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/lib/search/index-hooks', () => ({
  indexSearchDocument: vi.fn(),
}))
vi.mock('@/src/repositories/whatsapp-ai-config.repository')
vi.mock('@/src/services/crm-campaign-tracking.service')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/lib/whatsapp/send', () => ({ WhatsAppSend: { text: vi.fn() } }))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/services/whatsapp-button-action.service', () => ({
  WhatsAppButtonActionService: { handleClick: vi.fn() },
}))
const { aiReplyAdd, sentimentAdd } = vi.hoisted(() => ({
  aiReplyAdd: vi.fn(async () => undefined),
  sentimentAdd: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappMediaQueue: vi.fn(() => ({ add: vi.fn() })),
  getWhatsappAiReplyQueue: vi.fn(() => ({ add: aiReplyAdd })),
  getWhatsappSentimentQueue: vi.fn(() => ({ add: sentimentAdd })),
}))

import { logger } from '@/lib/axiom/logger'
import { WhatsAppAiConfigRepository } from '@/src/repositories/whatsapp-ai-config.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppButtonActionService } from '../whatsapp-button-action.service'
import { WhatsAppWebhookService } from '../whatsapp-webhook.service'

const aiConfigRepo = vi.mocked(WhatsAppAiConfigRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const messageRepo = vi.mocked(WhatsAppMessageRepository)
const buttons = vi.mocked(WhatsAppButtonActionService)

const connection = createFakeWhatsAppConnection({
  id: 'conn1',
  workspaceId: 'ws1',
  module: 'COMMUNICATION',
})

beforeEach(() => {
  vi.clearAllMocks()
  messageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
  contactRepo.upsertByWaId.mockResolvedValue(
    ok(createFakeWhatsAppContact({ id: 'ct1', workspaceId: 'ws1' })),
  )
  aiConfigRepo.findByWorkspace.mockResolvedValue(
    ok(createFakeWhatsAppAiConfig({ workspaceId: 'ws1', active: true })),
  )
  const conversation = createFakeWhatsAppConversation({
    id: 'c1',
    workspaceId: 'ws1',
    aiActive: true,
  })
  conversationRepo.findActiveByContact.mockResolvedValue(ok(conversation))
  conversationRepo.update.mockResolvedValue(ok(conversation))
  conversationRepo.findById.mockResolvedValue(
    ok(createFakeWhatsAppConversationWithPreview({ id: 'c1' })),
  )
  messageRepo.create.mockResolvedValue(
    ok(createFakeWhatsAppMessage({ id: 'm1', conversationId: 'c1' })),
  )
})

const click = (buttonPayload?: string) =>
  WhatsAppWebhookService.ingestInboundMessage({
    connection,
    waId: '5511',
    providerMessageId: 'wamid.click',
    type: 'BUTTON',
    text: 'Sim',
    buttonPayload,
  })

describe('WhatsAppWebhookService — button clicks', () => {
  it('stores the payload and hands the click to the action engine', async () => {
    buttons.handleClick.mockResolvedValue(ok({ matched: true, actions: 2 }))

    expectOk(await click('stl:t:tpl1:b1'))

    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'IN',
        type: 'BUTTON',
        text: 'Sim',
        buttonPayload: 'stl:t:tpl1:b1',
      }),
    )
    expect(buttons.handleClick).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      conversationId: 'c1',
      messageId: 'm1',
      payload: 'stl:t:tpl1:b1',
    })
    // The button's actions own the answer.
    expect(aiReplyAdd).not.toHaveBeenCalled()
  })

  it('lets the AI answer a click whose button has no actions', async () => {
    buttons.handleClick.mockResolvedValue(ok({ matched: true, actions: 0 }))
    expectOk(await click('stl:q:qr1:b1'))
    expect(aiReplyAdd).toHaveBeenCalled()
  })

  it('logs a failed click handling and goes on', async () => {
    buttons.handleClick.mockResolvedValue(err(databaseError()))
    expectOk(await click('stl:q:qr1:b1'))
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.button.click_failed',
      expect.objectContaining({ reason: 'DATABASE_ERROR' }),
    )
    expect(aiReplyAdd).toHaveBeenCalled()
  })

  it('does not call the engine without a payload', async () => {
    expectOk(await click(undefined))
    expect(buttons.handleClick).not.toHaveBeenCalled()
  })
})
