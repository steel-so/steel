import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppAiConfig } from '@/src/__tests__/factories/whatsapp-ai-config.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import {
  createFakeWhatsAppConversation,
  createFakeWhatsAppConversationWithPreview,
} from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppGroupWithParticipants } from '@/src/__tests__/factories/whatsapp-group.factory'
import { createFakeWhatsAppGroupMessage } from '@/src/__tests__/factories/whatsapp-group-message.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

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
  WhatsAppUsageService: {
    assertCanSend: vi.fn(async () => ({ ok: true, value: undefined })),
    record: vi.fn(async () => undefined),
  },
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/whatsapp-ai-config.repository')
vi.mock('@/src/services/crm-campaign-tracking.service')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-conversation-event.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/whatsapp-group.repository')
vi.mock('@/src/repositories/whatsapp-group-message.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))

const { mediaAdd, aiReplyAdd, sentimentAdd } = vi.hoisted(() => ({
  mediaAdd: vi.fn(async () => undefined),
  aiReplyAdd: vi.fn(async () => undefined),
  sentimentAdd: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappMediaQueue: vi.fn(() => ({ add: mediaAdd })),
  getWhatsappAiReplyQueue: vi.fn(() => ({ add: aiReplyAdd })),
  getWhatsappSentimentQueue: vi.fn(() => ({ add: sentimentAdd })),
}))

import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { WhatsAppAiCampaignRepository } from '@/src/repositories/whatsapp-ai-campaign.repository'
import { WhatsAppAiConfigRepository } from '@/src/repositories/whatsapp-ai-config.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppGroupRepository } from '@/src/repositories/whatsapp-group.repository'
import { WhatsAppGroupMessageRepository } from '@/src/repositories/whatsapp-group-message.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { emitWhatsAppConversationWaiting } from '../whatsapp-conversation-waiting'
import { WhatsAppUsageService } from '../whatsapp-usage.service'
import { WhatsAppWebhookService } from '../whatsapp-webhook.service'

const mockedAiConfigRepo = vi.mocked(WhatsAppAiConfigRepository)
const mockedContactRepo = vi.mocked(WhatsAppContactRepository)
const mockedConversationRepo = vi.mocked(WhatsAppConversationRepository)
const mockedEventRepo = vi.mocked(WhatsAppConversationEventRepository)
const mockedGroupRepo = vi.mocked(WhatsAppGroupRepository)
const mockedGroupMessageRepo = vi.mocked(WhatsAppGroupMessageRepository)
const mockedMessageRepo = vi.mocked(WhatsAppMessageRepository)
const mockedSend = vi.mocked(WhatsAppSend)
const mockedUsage = vi.mocked(WhatsAppUsageService)

const connection = createFakeWhatsAppConnection({
  id: 'conn1',
  workspaceId: 'ws1',
})

function baseInbound(
  overrides: Partial<
    Parameters<typeof WhatsAppWebhookService.ingestInboundMessage>[0]
  > = {},
) {
  return {
    connection,
    waId: '5511988887777',
    contactName: 'Maria Silva',
    providerMessageId: 'pm-new',
    type: 'TEXT' as const,
    text: 'Olá!',
    ...overrides,
  }
}

describe('WhatsAppWebhookService', () => {
  beforeEach(() => {
    // Padrão: contato sem conversa fechada para reabrir.
    mockedConversationRepo.findLatestClosedByContact.mockResolvedValue(ok(null))
  })

  describe('closed conversation reopening', () => {
    function arrangeClosed(options: { aiConfigActive: boolean }) {
      mockedMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
      mockedContactRepo.upsertByWaId.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1', workspaceId: 'ws1' })),
      )
      mockedAiConfigRepo.findByWorkspace.mockResolvedValue(
        ok(
          createFakeWhatsAppAiConfig({
            workspaceId: 'ws1',
            active: options.aiConfigActive,
          }),
        ),
      )
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(null))
      const closed = createFakeWhatsAppConversation({
        id: 'closed1',
        workspaceId: 'ws1',
        contactId: 'contact1',
        status: 'CLOSED',
        assignedUserId: 'agent1',
        aiActive: false,
        aiHandoff: true,
        closedAt: new Date(),
      })
      mockedConversationRepo.findLatestClosedByContact.mockResolvedValue(
        ok(closed),
      )
      mockedConversationRepo.update.mockResolvedValue(
        ok({ ...closed, status: 'IN_PROGRESS' }),
      )
      mockedEventRepo.create.mockResolvedValue(
        ok({
          id: 'ev1',
          workspaceId: 'ws1',
          conversationId: 'closed1',
          kind: 'REOPENED',
          source: 'CONTACT',
          actorUserId: null,
          reason: null,
          closeOutcome: null,
          closeStatusLabels: [],
          createdAt: new Date(),
        }),
      )
      mockedMessageRepo.create.mockResolvedValue(
        ok(
          createFakeWhatsAppMessage({ id: 'msg1', conversationId: 'closed1' }),
        ),
      )
      mockedConversationRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppConversationWithPreview({ id: 'closed1' })),
      )
    }

    it('should reopen the closed conversation instead of creating a new one', async () => {
      arrangeClosed({ aiConfigActive: true })

      expectOk(await WhatsAppWebhookService.ingestInboundMessage(baseInbound()))

      expect(mockedConversationRepo.create).not.toHaveBeenCalled()
      expect(mockedConversationRepo.update).toHaveBeenCalledWith(
        'closed1',
        expect.objectContaining({
          status: 'IN_PROGRESS',
          closedAt: null,
          closeReason: null,
          aiActive: true,
          aiHandoff: false,
          unreadCount: { increment: 1 },
        }),
      )
      expect(mockedEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'closed1',
          kind: 'REOPENED',
          source: 'CONTACT',
          actorUserId: null,
        }),
      )
      expect(mockedMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'closed1' }),
      )
      // Reaberta com a IA ligada no workspace: a IA volta a responder.
      expect(aiReplyAdd).toHaveBeenCalledWith(
        'generate-ai-reply',
        expect.objectContaining({ conversationId: 'closed1' }),
      )
      // A reopened conversation is a new attendance: counts in the month.
      expect(mockedUsage.record).toHaveBeenCalledWith('ws1', 'conversations')
      // Its agent still has it: it does not enter the queue.
      expect(emitWhatsAppConversationWaiting).not.toHaveBeenCalled()
    })

    it('should announce a reopened conversation without an agent as waiting', async () => {
      arrangeClosed({ aiConfigActive: false })
      const closed = createFakeWhatsAppConversation({
        id: 'closed1',
        workspaceId: 'ws1',
        contactId: 'contact1',
        status: 'CLOSED',
        assignedUserId: null,
      })
      const reopened = { ...closed, status: 'NEW' as const }
      mockedConversationRepo.findLatestClosedByContact.mockResolvedValue(
        ok(closed),
      )
      mockedConversationRepo.update.mockResolvedValue(ok(reopened))

      expectOk(await WhatsAppWebhookService.ingestInboundMessage(baseInbound()))

      expect(emitWhatsAppConversationWaiting).toHaveBeenCalledWith({
        conversation: reopened,
        contact: expect.objectContaining({ id: 'contact1' }),
        reason: 'reopened',
        actorId: null,
      })
    })

    it('should reopen without AI when the workspace AI is off', async () => {
      arrangeClosed({ aiConfigActive: false })

      expectOk(await WhatsAppWebhookService.ingestInboundMessage(baseInbound()))

      expect(mockedConversationRepo.update).toHaveBeenCalledWith(
        'closed1',
        expect.objectContaining({ aiActive: false }),
      )
      expect(aiReplyAdd).not.toHaveBeenCalled()
    })

    it('should keep the AI on when reopening a campaign conversation and mark the reply', async () => {
      arrangeClosed({ aiConfigActive: false })
      const closed = createFakeWhatsAppConversation({
        id: 'closed1',
        workspaceId: 'ws1',
        contactId: 'contact1',
        status: 'CLOSED',
        aiCampaignId: 'cp1',
      })
      mockedConversationRepo.findLatestClosedByContact.mockResolvedValue(
        ok(closed),
      )

      expectOk(await WhatsAppWebhookService.ingestInboundMessage(baseInbound()))

      expect(mockedConversationRepo.update).toHaveBeenCalledWith(
        'closed1',
        expect.objectContaining({ aiActive: true }),
      )
      expect(aiReplyAdd).toHaveBeenCalledWith(
        'generate-ai-reply',
        expect.objectContaining({ conversationId: 'closed1' }),
      )
      expect(WhatsAppAiCampaignRepository.markReplied).toHaveBeenCalledWith(
        'closed1',
        expect.any(Date),
      )
    })

    it('should reopen a closed conversation when the agent writes from the phone', async () => {
      arrangeClosed({ aiConfigActive: true })

      expectOk(
        await WhatsAppWebhookService.ingestOutboundDeviceMessage(baseInbound()),
      )

      expect(mockedConversationRepo.create).not.toHaveBeenCalled()
      expect(mockedConversationRepo.update).toHaveBeenCalledWith(
        'closed1',
        expect.objectContaining({ aiActive: false, aiHandoff: true }),
      )
      expect(mockedEventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'REOPENED', source: 'AGENT' }),
      )
    })
  })

  describe('ingestInboundMessage()', () => {
    it('should be a no-op when the message was already ingested (dedupe)', async () => {
      mockedMessageRepo.findByProviderMessageId.mockResolvedValue(
        ok(createFakeWhatsAppMessage({ providerMessageId: 'pm-new' })),
      )

      const result = await WhatsAppWebhookService.ingestInboundMessage(
        baseInbound(),
      )

      expectOk(result)
      expect(mockedContactRepo.upsertByWaId).not.toHaveBeenCalled()
    })

    it('should create a new conversation with AI active when the workspace AI config is active', async () => {
      mockedMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
      const contact = createFakeWhatsAppContact({
        id: 'contact1',
        waId: '5511988887777',
      })
      mockedContactRepo.upsertByWaId.mockResolvedValue(ok(contact))
      mockedAiConfigRepo.findByWorkspace.mockResolvedValue(
        ok(createFakeWhatsAppAiConfig({ active: true })),
      )
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(null))
      const created = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        contactId: 'contact1',
        aiActive: true,
      })
      mockedConversationRepo.create.mockResolvedValue(ok(created))
      mockedConversationRepo.findById.mockResolvedValue(ok(created))
      mockedMessageRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppMessage({ conversationId: 'conv1' })),
      )

      const result = await WhatsAppWebhookService.ingestInboundMessage(
        baseInbound(),
      )

      expectOk(result)
      expect(mockedConversationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ aiActive: true, status: 'NEW' }),
      )
      // Inbound is counted but never blocked by the monthly limit.
      expect(mockedUsage.record).toHaveBeenCalledWith('ws1', 'conversations')
      expect(mockedUsage.assertCanSend).not.toHaveBeenCalled()
      expect(aiReplyAdd).toHaveBeenCalledWith(
        'generate-ai-reply',
        expect.objectContaining({ conversationId: 'conv1' }),
      )
      expect(sentimentAdd).toHaveBeenCalledWith(
        'analyze-message',
        expect.objectContaining({ messageId: expect.any(String) }),
      )
      // A brand-new conversation lands in the queue.
      expect(emitWhatsAppConversationWaiting).toHaveBeenCalledWith({
        conversation: created,
        contact,
        reason: 'new',
        actorId: null,
      })
    })

    describe('LGPD opt-out keyword', () => {
      function mockInboundPipeline(
        contact = createFakeWhatsAppContact({ id: 'contact1' }),
      ) {
        mockedMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
        mockedContactRepo.upsertByWaId.mockResolvedValue(ok(contact))
        mockedContactRepo.setBroadcastOptOut.mockResolvedValue(
          ok({ ...contact, broadcastOptedOutAt: new Date() }),
        )
        mockedAiConfigRepo.findByWorkspace.mockResolvedValue(
          ok(createFakeWhatsAppAiConfig({ active: true })),
        )
        mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(null))
        const created = createFakeWhatsAppConversationWithPreview({
          id: 'conv1',
          contactId: 'contact1',
          aiActive: true,
        })
        mockedConversationRepo.create.mockResolvedValue(ok(created))
        mockedConversationRepo.findById.mockResolvedValue(ok(created))
        mockedConversationRepo.update.mockResolvedValue(ok(created))
        mockedMessageRepo.create.mockResolvedValue(
          ok(createFakeWhatsAppMessage({ conversationId: 'conv1' })),
        )
        mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'wamid.x' }))
      }

      it('should opt the contact out, confirm and skip the AI reply', async () => {
        mockInboundPipeline()

        expectOk(
          await WhatsAppWebhookService.ingestInboundMessage(
            baseInbound({ text: '  Sáir! ' }),
          ),
        )

        expect(mockedContactRepo.setBroadcastOptOut).toHaveBeenCalledWith(
          'contact1',
          { at: expect.any(Date), source: 'KEYWORD' },
        )
        // Compliance reply: always sent, never metered.
        expect(mockedSend.text).toHaveBeenCalledWith(
          connection,
          {
            to: '5511988887777',
            text: expect.stringMatching(/não receberá mais/),
          },
          { unmetered: true },
        )
        expect(mockedMessageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ direction: 'OUT', status: 'SENT' }),
        )
        expect(aiReplyAdd).not.toHaveBeenCalled()
      })

      it('should not re-record an opt-out for a contact already opted out', async () => {
        const at = new Date('2026-01-01T00:00:00.000Z')
        mockInboundPipeline(
          createFakeWhatsAppContact({
            id: 'contact1',
            broadcastOptedOutAt: at,
            broadcastOptOutSource: 'ADMIN',
          }),
        )

        expectOk(
          await WhatsAppWebhookService.ingestInboundMessage(
            baseInbound({ text: 'STOP' }),
          ),
        )

        expect(mockedContactRepo.setBroadcastOptOut).not.toHaveBeenCalled()
        expect(mockedSend.text).toHaveBeenCalledTimes(1)
      })

      it('should not treat a bare CANCELAR (e.g. reply to a reminder) as opt-out', async () => {
        mockInboundPipeline()

        expectOk(
          await WhatsAppWebhookService.ingestInboundMessage(
            baseInbound({ text: 'Cancelar' }),
          ),
        )

        expect(mockedContactRepo.setBroadcastOptOut).not.toHaveBeenCalled()
        expect(mockedSend.text).not.toHaveBeenCalled()
      })

      it('should not treat a sentence containing the keyword as opt-out', async () => {
        mockInboundPipeline()

        expectOk(
          await WhatsAppWebhookService.ingestInboundMessage(
            baseInbound({ text: 'quero cancelar minha consulta' }),
          ),
        )

        expect(mockedContactRepo.setBroadcastOptOut).not.toHaveBeenCalled()
        expect(mockedSend.text).not.toHaveBeenCalled()
        expect(aiReplyAdd).toHaveBeenCalled()
      })
    })

    it('should not enqueue sentiment analysis for a text-less message', async () => {
      mockedMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
      mockedContactRepo.upsertByWaId.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      mockedAiConfigRepo.findByWorkspace.mockResolvedValue(ok(null))
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(null))
      const created = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        contactId: 'contact1',
      })
      mockedConversationRepo.create.mockResolvedValue(ok(created))
      mockedConversationRepo.findById.mockResolvedValue(ok(created))
      mockedMessageRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppMessage({ conversationId: 'conv1', text: null })),
      )

      await WhatsAppWebhookService.ingestInboundMessage(
        baseInbound({ text: undefined, type: 'IMAGE', rawMediaUrl: 'x' }),
      )

      expect(sentimentAdd).not.toHaveBeenCalled()
    })

    it('should not enqueue an AI reply when the workspace has no AI config', async () => {
      mockedMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
      mockedContactRepo.upsertByWaId.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      mockedAiConfigRepo.findByWorkspace.mockResolvedValue(ok(null))
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(null))
      const created = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        aiActive: false,
      })
      mockedConversationRepo.create.mockResolvedValue(ok(created))
      mockedConversationRepo.findById.mockResolvedValue(ok(created))
      mockedMessageRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppMessage()),
      )

      await WhatsAppWebhookService.ingestInboundMessage(baseInbound())

      expect(aiReplyAdd).not.toHaveBeenCalled()
    })

    it('should re-activate the AI on an existing conversation that was never explicitly handed off', async () => {
      mockedMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
      mockedContactRepo.upsertByWaId.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      mockedAiConfigRepo.findByWorkspace.mockResolvedValue(
        ok(createFakeWhatsAppAiConfig({ active: true })),
      )
      const existing = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        aiActive: false,
        aiHandoff: false,
      })
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(existing))
      mockedConversationRepo.update.mockResolvedValue(ok(existing))
      mockedConversationRepo.findById.mockResolvedValue(ok(existing))
      mockedMessageRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppMessage()),
      )

      await WhatsAppWebhookService.ingestInboundMessage(baseInbound())

      expect(mockedConversationRepo.update).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({ aiActive: true }),
      )
      expect(aiReplyAdd).toHaveBeenCalled()
      // Already open: no new "waiting" event per message.
      expect(emitWhatsAppConversationWaiting).not.toHaveBeenCalled()
    })

    it('should NOT re-activate the AI once a human has explicitly taken over (aiHandoff)', async () => {
      mockedMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
      mockedContactRepo.upsertByWaId.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      mockedAiConfigRepo.findByWorkspace.mockResolvedValue(
        ok(createFakeWhatsAppAiConfig({ active: true })),
      )
      const existing = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        aiActive: false,
        aiHandoff: true,
      })
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(existing))
      mockedConversationRepo.update.mockResolvedValue(ok(existing))
      mockedConversationRepo.findById.mockResolvedValue(ok(existing))
      mockedMessageRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppMessage()),
      )

      await WhatsAppWebhookService.ingestInboundMessage(baseInbound())

      expect(mockedConversationRepo.update).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({ aiActive: false }),
      )
      expect(aiReplyAdd).not.toHaveBeenCalled()
    })

    it('should NOT re-activate the AI on a conversation assigned to a person', async () => {
      mockedMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
      mockedContactRepo.upsertByWaId.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      mockedAiConfigRepo.findByWorkspace.mockResolvedValue(
        ok(createFakeWhatsAppAiConfig({ active: true })),
      )
      const existing = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        aiActive: false,
        aiHandoff: false,
        assignedUserId: 'user1',
      })
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(existing))
      mockedConversationRepo.update.mockResolvedValue(ok(existing))
      mockedConversationRepo.findById.mockResolvedValue(ok(existing))
      mockedMessageRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppMessage()),
      )

      await WhatsAppWebhookService.ingestInboundMessage(baseInbound())

      expect(mockedConversationRepo.update).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({ aiActive: false }),
      )
      expect(aiReplyAdd).not.toHaveBeenCalled()
    })

    it('should enqueue a media download job for messages with a raw media reference', async () => {
      mockedMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
      mockedContactRepo.upsertByWaId.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      mockedAiConfigRepo.findByWorkspace.mockResolvedValue(ok(null))
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(null))
      const created = createFakeWhatsAppConversationWithPreview({ id: 'conv1' })
      mockedConversationRepo.create.mockResolvedValue(ok(created))
      mockedConversationRepo.findById.mockResolvedValue(ok(created))
      const message = createFakeWhatsAppMessage({
        id: 'msg1',
        type: 'IMAGE',
        mediaUrl: 'raw-provider-url',
      })
      mockedMessageRepo.create.mockResolvedValue(ok(message))

      await WhatsAppWebhookService.ingestInboundMessage(
        baseInbound({ type: 'IMAGE', rawMediaUrl: 'raw-provider-url' }),
      )

      expect(mediaAdd).toHaveBeenCalledWith(
        'download-inbound-media',
        expect.objectContaining({ messageId: 'msg1' }),
      )
    })

    it('should resolve a quoted provider message id to our internal replyToMessageId', async () => {
      mockedMessageRepo.findByProviderMessageId.mockImplementation(
        async (providerMessageId: string) => {
          if (providerMessageId === 'pm-new') return ok(null)
          if (providerMessageId === 'pm-quoted') {
            return ok(createFakeWhatsAppMessage({ id: 'quoted-internal-id' }))
          }
          return ok(null)
        },
      )
      mockedContactRepo.upsertByWaId.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      mockedAiConfigRepo.findByWorkspace.mockResolvedValue(ok(null))
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(null))
      const created = createFakeWhatsAppConversationWithPreview({ id: 'conv1' })
      mockedConversationRepo.create.mockResolvedValue(ok(created))
      mockedConversationRepo.findById.mockResolvedValue(ok(created))
      mockedMessageRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppMessage()),
      )

      await WhatsAppWebhookService.ingestInboundMessage(
        baseInbound({ quotedProviderMessageId: 'pm-quoted' }),
      )

      expect(mockedMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ replyToMessageId: 'quoted-internal-id' }),
      )
    })
  })

  describe('ingestOutboundDeviceMessage()', () => {
    it('should be a no-op when the message was already ingested (dedupe)', async () => {
      mockedMessageRepo.findByProviderMessageId.mockResolvedValue(
        ok(createFakeWhatsAppMessage({ providerMessageId: 'pm-new' })),
      )

      const result = await WhatsAppWebhookService.ingestOutboundDeviceMessage(
        baseInbound(),
      )

      expectOk(result)
      expect(mockedContactRepo.upsertByWaId).not.toHaveBeenCalled()
    })

    it('should persist the message as OUT and hand off from AI on an existing conversation', async () => {
      mockedMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
      mockedContactRepo.upsertByWaId.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      const existing = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        aiActive: true,
        aiHandoff: false,
      })
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(existing))
      mockedConversationRepo.update.mockResolvedValue(ok(existing))
      mockedConversationRepo.findById.mockResolvedValue(ok(existing))
      mockedMessageRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppMessage({ conversationId: 'conv1' })),
      )

      await WhatsAppWebhookService.ingestOutboundDeviceMessage(baseInbound())

      expect(mockedConversationRepo.update).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({ aiActive: false, aiHandoff: true }),
      )
      expect(mockedMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'OUT', status: 'SENT' }),
      )
      expect(aiReplyAdd).not.toHaveBeenCalled()
    })

    it('should create a new conversation already handed off when none exists', async () => {
      mockedMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
      mockedContactRepo.upsertByWaId.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(null))
      const created = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        aiActive: false,
        aiHandoff: true,
      })
      mockedConversationRepo.create.mockResolvedValue(ok(created))
      mockedConversationRepo.findById.mockResolvedValue(ok(created))
      mockedMessageRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppMessage({ conversationId: 'conv1' })),
      )

      await WhatsAppWebhookService.ingestOutboundDeviceMessage(baseInbound())

      expect(mockedConversationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          aiActive: false,
          aiHandoff: true,
          unreadCount: 0,
        }),
      )
      expect(mockedUsage.record).toHaveBeenCalledWith('ws1', 'conversations')
    })

    it('should not count ServiceDesk conversations in the Communication usage', async () => {
      mockedMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
      mockedContactRepo.upsertByWaId.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(null))
      const created = createFakeWhatsAppConversationWithPreview({ id: 'conv1' })
      mockedConversationRepo.create.mockResolvedValue(ok(created))
      mockedConversationRepo.findById.mockResolvedValue(ok(created))
      mockedMessageRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppMessage({ conversationId: 'conv1' })),
      )

      await WhatsAppWebhookService.ingestOutboundDeviceMessage(
        baseInbound({
          connection: createFakeWhatsAppConnection({
            id: 'sd-conn',
            workspaceId: 'ws1',
            module: 'SERVICE_DESK',
          }),
        }),
      )

      expect(mockedConversationRepo.create).toHaveBeenCalled()
      expect(mockedUsage.record).not.toHaveBeenCalled()
    })
  })

  describe('ingestInboundReaction()', () => {
    it('should be a no-op when the message is unknown', async () => {
      mockedMessageRepo.updateReactionByProviderMessageId.mockResolvedValue(
        ok(null),
      )

      const result = await WhatsAppWebhookService.ingestInboundReaction({
        providerMessageId: 'unknown',
        emoji: '👍',
      })

      expectOk(result)
    })

    it('should persist the reaction as coming from the contact', async () => {
      const updated = createFakeWhatsAppMessage({
        reactionEmoji: '👍',
        reactedByContact: true,
      })
      mockedMessageRepo.updateReactionByProviderMessageId.mockResolvedValue(
        ok(updated),
      )

      const result = await WhatsAppWebhookService.ingestInboundReaction({
        providerMessageId: updated.providerMessageId ?? '',
        emoji: '👍',
      })

      expectOk(result)
      expect(
        mockedMessageRepo.updateReactionByProviderMessageId,
      ).toHaveBeenCalledWith(updated.providerMessageId, {
        emoji: '👍',
        reactedByContact: true,
      })
    })
  })

  describe('ingestStatusUpdate()', () => {
    it('should be a no-op when the message is unknown', async () => {
      mockedMessageRepo.updateStatusByProviderMessageId.mockResolvedValue(
        ok(null),
      )

      const result = await WhatsAppWebhookService.ingestStatusUpdate({
        providerMessageId: 'unknown',
        status: 'DELIVERED',
      })

      expectOk(result)
    })

    it('should update the message status when found', async () => {
      const updated = createFakeWhatsAppMessage({ status: 'READ' })
      mockedMessageRepo.updateStatusByProviderMessageId.mockResolvedValue(
        ok(updated),
      )

      const result = await WhatsAppWebhookService.ingestStatusUpdate({
        providerMessageId: updated.providerMessageId ?? '',
        status: 'READ',
      })

      expectOk(result)
    })
  })

  describe('ingestInboundGroupMessage()', () => {
    it('should persist the message against an existing group', async () => {
      mockedGroupMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
      const group = createFakeWhatsAppGroupWithParticipants({
        id: 'g1',
        groupJid: '120363000000000000-group',
      })
      mockedGroupRepo.findByGroupJid.mockResolvedValue(ok(group))
      const created = createFakeWhatsAppGroupMessage({
        groupId: 'g1',
        senderWaId: '5511988887777',
        senderName: 'Maria',
      })
      mockedGroupMessageRepo.create.mockResolvedValue(ok(created))
      mockedGroupRepo.update.mockResolvedValue(ok(group))

      const result = await WhatsAppWebhookService.ingestInboundGroupMessage({
        connection,
        groupJid: '120363000000000000-group',
        senderWaId: '5511988887777',
        senderName: 'Maria',
        providerMessageId: 'pm-group-1',
        type: 'TEXT',
        text: 'Bom dia',
      })

      expectOk(result)
      expect(mockedGroupRepo.create).not.toHaveBeenCalled()
      expect(mockedGroupMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'g1', senderWaId: '5511988887777' }),
      )
    })

    it('should auto-create the group instead of dropping the message when unknown', async () => {
      mockedGroupMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
      mockedGroupRepo.findByGroupJid.mockResolvedValue(ok(null))
      const autoCreated = createFakeWhatsAppGroupWithParticipants({
        id: 'g-new',
        groupJid: '120363000000000000-group',
        name: 'Grupo do Zap',
      })
      mockedGroupRepo.create.mockResolvedValue(ok(autoCreated))
      const created = createFakeWhatsAppGroupMessage({ groupId: 'g-new' })
      mockedGroupMessageRepo.create.mockResolvedValue(ok(created))
      mockedGroupRepo.update.mockResolvedValue(ok(autoCreated))

      const result = await WhatsAppWebhookService.ingestInboundGroupMessage({
        connection,
        groupJid: '120363000000000000-group',
        groupName: 'Grupo do Zap',
        senderWaId: '5511988887777',
        senderName: 'Maria',
        providerMessageId: 'pm-group-2',
        type: 'TEXT',
        text: 'Primeira mensagem de um grupo desconhecido',
      })

      expectOk(result)
      expect(mockedGroupRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws1',
          connectionId: 'conn1',
          groupJid: '120363000000000000-group',
          name: 'Grupo do Zap',
        }),
      )
      expect(mockedGroupMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'g-new' }),
      )
    })

    it('should dedupe by providerMessageId', async () => {
      mockedGroupMessageRepo.findByProviderMessageId.mockResolvedValue(
        ok(createFakeWhatsAppGroupMessage({ providerMessageId: 'pm-dup' })),
      )

      const result = await WhatsAppWebhookService.ingestInboundGroupMessage({
        connection,
        groupJid: '120363000000000000-group',
        senderWaId: '5511988887777',
        providerMessageId: 'pm-dup',
        type: 'TEXT',
        text: 'Duplicada',
      })

      expectOk(result)
      expect(mockedGroupRepo.findByGroupJid).not.toHaveBeenCalled()
    })
  })
})
