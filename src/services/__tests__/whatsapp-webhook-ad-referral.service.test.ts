import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeInboundAdReferral } from '@/src/__tests__/factories/nov-z4-ctwa-attribution.factory'
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
vi.mock('@/src/services/whatsapp-ad-attribution.service', () => ({
  WhatsAppAdAttributionService: { onInboundReferral: vi.fn() },
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
import { WhatsAppAdAttributionService } from '../whatsapp-ad-attribution.service'
import { WhatsAppWebhookService } from '../whatsapp-webhook.service'

const aiConfigRepo = vi.mocked(WhatsAppAiConfigRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const messageRepo = vi.mocked(WhatsAppMessageRepository)
const attribution = vi.mocked(WhatsAppAdAttributionService)

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

const referral = createFakeInboundAdReferral()

const receive = (
  overrides: Partial<
    Parameters<typeof WhatsAppWebhookService.ingestInboundMessage>[0]
  > = {},
) =>
  WhatsAppWebhookService.ingestInboundMessage({
    connection,
    waId: '5511',
    providerMessageId: 'wamid.ad',
    type: 'TEXT',
    text: 'Olá, vi o anúncio',
    referral,
    ...overrides,
  })

describe('WhatsAppWebhookService — Click-to-WhatsApp referral', () => {
  it('hands the ad referral to the attribution service', async () => {
    attribution.onInboundReferral.mockResolvedValue(ok(undefined))

    expectOk(await receive())

    expect(attribution.onInboundReferral).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      contact: expect.objectContaining({ id: 'ct1' }),
      conversationId: 'c1',
      providerMessageId: 'wamid.ad',
      referral,
    })
  })

  it('does not call it for an ordinary message', async () => {
    expectOk(await receive({ referral: undefined }))
    expect(attribution.onInboundReferral).not.toHaveBeenCalled()
  })

  it('does not attribute ServiceDesk connections', async () => {
    expectOk(
      await receive({
        connection: { ...connection, module: 'SERVICE_DESK' },
      }),
    )
    expect(attribution.onInboundReferral).not.toHaveBeenCalled()
  })

  it('logs a failed attribution and keeps the message flow', async () => {
    attribution.onInboundReferral.mockResolvedValue(err(databaseError()))

    expectOk(await receive())

    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.ad.attribution_failed',
      expect.objectContaining({ workspaceId: 'ws1', conversationId: 'c1' }),
    )
    // The AI still answers the message.
    expect(aiReplyAdd).toHaveBeenCalled()
  })
})
