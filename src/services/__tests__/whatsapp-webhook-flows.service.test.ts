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

vi.mock('@/src/repositories/whatsapp-ai-campaign.repository', () => ({
  WhatsAppAiCampaignRepository: {
    markReplied: vi.fn(async () => ({ ok: true, value: 0 })),
  },
}))
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
vi.mock('@/src/services/whatsapp-chatbot-runtime.service', () => ({
  WhatsAppChatbotRuntimeService: { claimInbound: vi.fn() },
}))
vi.mock('@/src/services/whatsapp-flow-response.service', () => ({
  WhatsAppFlowResponseService: { handleInbound: vi.fn() },
}))
const { aiReplyAdd } = vi.hoisted(() => ({
  aiReplyAdd: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappMediaQueue: vi.fn(() => ({ add: vi.fn() })),
  getWhatsappAiReplyQueue: vi.fn(() => ({ add: aiReplyAdd })),
  getWhatsappSentimentQueue: vi.fn(() => ({ add: vi.fn() })),
}))

import { logger } from '@/lib/axiom/logger'
import { WhatsAppAiConfigRepository } from '@/src/repositories/whatsapp-ai-config.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppChatbotRuntimeService } from '../whatsapp-chatbot-runtime.service'
import { WhatsAppFlowResponseService } from '../whatsapp-flow-response.service'
import { WhatsAppWebhookService } from '../whatsapp-webhook.service'

const aiConfigRepo = vi.mocked(WhatsAppAiConfigRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const messageRepo = vi.mocked(WhatsAppMessageRepository)
const flows = vi.mocked(WhatsAppFlowResponseService)
const chatbot = vi.mocked(WhatsAppChatbotRuntimeService)

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
  chatbot.claimInbound.mockResolvedValue(ok({ engaged: false }))
})

const answer = (overrides = {}) =>
  WhatsAppWebhookService.ingestInboundMessage({
    connection,
    waId: '5511',
    providerMessageId: 'wamid.flow',
    type: 'TEXT',
    text: '[Formulário respondido]',
    flowResponseJson: '{"flow_token":"stlf.f.n","nome":"Ana"}',
    ...overrides,
  })

describe('WhatsAppWebhookService — WhatsApp Flow answers', () => {
  it('hands the answer to the flow service and keeps the AI and the bot quiet', async () => {
    const afterPublish = vi.fn(async () => undefined)
    flows.handleInbound.mockResolvedValue(
      ok({
        handled: true,
        text: 'Formulário respondido: X\nNome: Ana',
        afterPublish,
      }),
    )

    expectOk(await answer())

    expect(flows.handleInbound).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      connection,
      contact: expect.objectContaining({ id: 'ct1' }),
      conversationId: 'c1',
      messageId: 'm1',
      responseJson: '{"flow_token":"stlf.f.n","nome":"Ana"}',
    })
    expect(afterPublish).toHaveBeenCalledTimes(1)
    expect(chatbot.claimInbound).not.toHaveBeenCalled()
    expect(aiReplyAdd).not.toHaveBeenCalled()
  })

  it('skips the thank-you when the flow has none', async () => {
    flows.handleInbound.mockResolvedValue(ok({ handled: true }))
    expectOk(await answer())
    expect(aiReplyAdd).not.toHaveBeenCalled()
  })

  it('lets the usual pipeline run when the reply belongs to no flow', async () => {
    flows.handleInbound.mockResolvedValue(ok({ handled: false }))
    expectOk(await answer())
    expect(chatbot.claimInbound).toHaveBeenCalled()
    expect(aiReplyAdd).toHaveBeenCalled()
  })

  it('logs a failed flow handling and goes on', async () => {
    flows.handleInbound.mockResolvedValue(err(databaseError()))
    expectOk(await answer())
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.flow.reply_failed',
      expect.objectContaining({ reason: 'DATABASE_ERROR' }),
    )
    expect(aiReplyAdd).toHaveBeenCalled()
  })

  it('does not look for a flow in a plain message', async () => {
    expectOk(await answer({ flowResponseJson: undefined, text: 'oi' }))
    expect(flows.handleInbound).not.toHaveBeenCalled()
  })

  it('ignores flow answers on ServiceDesk connections', async () => {
    const serviceDesk = createFakeWhatsAppConnection({
      id: 'sd1',
      workspaceId: 'ws1',
      module: 'SERVICE_DESK',
    })
    await WhatsAppWebhookService.ingestInboundMessage({
      connection: serviceDesk,
      waId: '5511',
      providerMessageId: 'wamid.sd',
      type: 'TEXT',
      text: '[Formulário respondido]',
      flowResponseJson: '{"nome":"Ana"}',
    }).catch(() => undefined)
    expect(flows.handleInbound).not.toHaveBeenCalled()
  })
})
