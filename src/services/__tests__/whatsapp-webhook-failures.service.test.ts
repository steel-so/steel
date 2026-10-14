import { describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import {
  createFakeWhatsAppConversation,
  createFakeWhatsAppConversationWithPreview,
} from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppGroupWithParticipants } from '@/src/__tests__/factories/whatsapp-group.factory'
import { createFakeWhatsAppGroupMessage } from '@/src/__tests__/factories/whatsapp-group-message.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import type { AppError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'

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

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { WhatsAppAiConfigRepository } from '@/src/repositories/whatsapp-ai-config.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppGroupRepository } from '@/src/repositories/whatsapp-group.repository'
import { WhatsAppGroupMessageRepository } from '@/src/repositories/whatsapp-group-message.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppWebhookService } from '../whatsapp-webhook.service'

const mockedAiConfigRepo = vi.mocked(WhatsAppAiConfigRepository)
const mockedContactRepo = vi.mocked(WhatsAppContactRepository)
const mockedConversationRepo = vi.mocked(WhatsAppConversationRepository)
const _mockedEventRepo = vi.mocked(WhatsAppConversationEventRepository)
const mockedGroupRepo = vi.mocked(WhatsAppGroupRepository)
const mockedGroupMessageRepo = vi.mocked(WhatsAppGroupMessageRepository)
const mockedMessageRepo = vi.mocked(WhatsAppMessageRepository)
const mockedSend = vi.mocked(WhatsAppSend)

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

const DB_ERROR: AppError = { code: 'DATABASE_ERROR', message: 'db down' }

function arrangeHappy() {
  mockedMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
  mockedContactRepo.upsertByWaId.mockResolvedValue(
    ok(createFakeWhatsAppContact({ id: 'contact1', workspaceId: 'ws1' })),
  )
  mockedAiConfigRepo.findByWorkspace.mockResolvedValue(ok(null))
  mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(null))
  mockedConversationRepo.findLatestClosedByContact.mockResolvedValue(ok(null))
  const conversation = createFakeWhatsAppConversation({
    id: 'conv1',
    workspaceId: 'ws1',
  })
  mockedConversationRepo.create.mockResolvedValue(ok(conversation))
  mockedConversationRepo.update.mockResolvedValue(ok(conversation))
  mockedConversationRepo.findById.mockResolvedValue(
    ok(createFakeWhatsAppConversationWithPreview({ id: 'conv1' })),
  )
  mockedMessageRepo.create.mockResolvedValue(
    ok(createFakeWhatsAppMessage({ id: 'msg1', conversationId: 'conv1' })),
  )
  return conversation
}

const closedConversation = () =>
  createFakeWhatsAppConversation({
    id: 'closed1',
    workspaceId: 'ws1',
    status: 'CLOSED',
  })

type Ingest = (input: ReturnType<typeof baseInbound>) => Promise<Result<void>>

const directMessageFlows: [string, Ingest][] = [
  [
    'ingestInboundMessage',
    (i) => WhatsAppWebhookService.ingestInboundMessage(i),
  ],
  [
    'ingestOutboundDeviceMessage',
    (i) => WhatsAppWebhookService.ingestOutboundDeviceMessage(i),
  ],
]

describe.each(directMessageFlows)(
  'WhatsAppWebhookService.%s() failures',
  (_name, ingest) => {
    it('should propagate a dedupe lookup failure', async () => {
      arrangeHappy()
      mockedMessageRepo.findByProviderMessageId.mockResolvedValue(err(DB_ERROR))

      expectErr(await ingest(baseInbound()), 'DATABASE_ERROR')
      expect(mockedContactRepo.upsertByWaId).not.toHaveBeenCalled()
    })

    it('should propagate a contact upsert failure', async () => {
      arrangeHappy()
      mockedContactRepo.upsertByWaId.mockResolvedValue(err(DB_ERROR))

      expectErr(await ingest(baseInbound()), 'DATABASE_ERROR')
    })

    it('should propagate an active conversation lookup failure', async () => {
      arrangeHappy()
      mockedConversationRepo.findActiveByContact.mockResolvedValue(
        err(DB_ERROR),
      )

      expectErr(await ingest(baseInbound()), 'DATABASE_ERROR')
    })

    it('should propagate a failure updating the active conversation', async () => {
      arrangeHappy()
      mockedConversationRepo.findActiveByContact.mockResolvedValue(
        ok(createFakeWhatsAppConversation({ id: 'conv1' })),
      )
      mockedConversationRepo.update.mockResolvedValue(err(DB_ERROR))

      expectErr(await ingest(baseInbound()), 'DATABASE_ERROR')
      expect(mockedMessageRepo.create).not.toHaveBeenCalled()
    })

    it('should propagate a closed conversation lookup failure', async () => {
      arrangeHappy()
      mockedConversationRepo.findLatestClosedByContact.mockResolvedValue(
        err(DB_ERROR),
      )

      expectErr(await ingest(baseInbound()), 'DATABASE_ERROR')
    })

    it('should propagate a failure reopening the closed conversation', async () => {
      arrangeHappy()
      mockedConversationRepo.findLatestClosedByContact.mockResolvedValue(
        ok(closedConversation()),
      )
      mockedConversationRepo.update.mockResolvedValue(err(DB_ERROR))

      expectErr(await ingest(baseInbound()), 'DATABASE_ERROR')
    })

    it('should propagate a failure creating the conversation', async () => {
      arrangeHappy()
      mockedConversationRepo.create.mockResolvedValue(err(DB_ERROR))

      expectErr(await ingest(baseInbound()), 'DATABASE_ERROR')
    })

    it('should propagate a failure persisting the message', async () => {
      arrangeHappy()
      mockedMessageRepo.create.mockResolvedValue(err(DB_ERROR))

      expectErr(await ingest(baseInbound()), 'DATABASE_ERROR')
      expect(publishWhatsAppEvent).not.toHaveBeenCalled()
    })

    it('should drop the quote when the quoted message is unknown', async () => {
      arrangeHappy()
      mockedMessageRepo.findByProviderMessageId
        .mockResolvedValueOnce(ok(null))
        .mockResolvedValueOnce(err(DB_ERROR))

      expectOk(
        await ingest(baseInbound({ quotedProviderMessageId: 'wamid-quoted' })),
      )

      expect(mockedMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ replyToMessageId: undefined }),
      )
    })

    it('should skip the conversation snapshot when the refresh fails', async () => {
      arrangeHappy()
      mockedConversationRepo.findById.mockResolvedValue(err(DB_ERROR))

      expectOk(await ingest(baseInbound()))

      expect(publishWhatsAppEvent).toHaveBeenCalledTimes(1)
      expect(publishWhatsAppEvent).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({ type: 'message.created' }),
      )
    })
  },
)

describe('WhatsAppWebhookService.ingestInboundMessage() specifics', () => {
  it('should propagate an AI config lookup failure', async () => {
    arrangeHappy()
    mockedAiConfigRepo.findByWorkspace.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppWebhookService.ingestInboundMessage(baseInbound()),
      'DATABASE_ERROR',
    )
  })

  describe('LGPD opt-out edge cases', () => {
    function arrangeOptOut() {
      arrangeHappy()
      mockedContactRepo.setBroadcastOptOut.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      mockedSend.text.mockResolvedValue(ok({ providerMessageId: 'wamid-ok' }))
    }

    it('should audit a failed opt-out write and still confirm', async () => {
      arrangeOptOut()
      mockedContactRepo.setBroadcastOptOut.mockResolvedValue(err(DB_ERROR))

      expectOk(
        await WhatsAppWebhookService.ingestInboundMessage(
          baseInbound({ text: 'SAIR' }),
        ),
      )

      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'opt_out',
          outcome: 'failure',
          reason: 'DATABASE_ERROR',
        }),
      )
      expect(mockedSend.text).toHaveBeenCalled()
    })

    it('should log when the confirmation cannot be sent and keep the opt-out', async () => {
      arrangeOptOut()
      mockedSend.text.mockResolvedValue(
        err({ code: 'WHATSAPP_PROVIDER_ERROR', message: 'offline' }),
      )

      expectOk(
        await WhatsAppWebhookService.ingestInboundMessage(
          baseInbound({ text: 'SAIR' }),
        ),
      )

      expect(logger.warn).toHaveBeenCalledWith(
        'whatsapp.opt_out.confirmation_failed',
        expect.objectContaining({
          contactId: 'contact1',
          reason: 'WHATSAPP_PROVIDER_ERROR',
        }),
      )
      expect(mockedContactRepo.setBroadcastOptOut).toHaveBeenCalled()
      expect(mockedMessageRepo.create).toHaveBeenCalledTimes(1)
    })

    it('should not publish the confirmation when persisting it fails', async () => {
      arrangeOptOut()
      mockedMessageRepo.create
        .mockResolvedValueOnce(
          ok(
            createFakeWhatsAppMessage({ id: 'msg1', conversationId: 'conv1' }),
          ),
        )
        .mockResolvedValueOnce(err(DB_ERROR))

      expectOk(
        await WhatsAppWebhookService.ingestInboundMessage(
          baseInbound({ text: 'SAIR' }),
        ),
      )

      const createdEvents = vi
        .mocked(publishWhatsAppEvent)
        .mock.calls.filter(([, event]) => event.type === 'message.created')
      expect(createdEvents).toHaveLength(1)
    })
  })
})

describe('WhatsAppWebhookService.ingestOutboundDeviceMessage() specifics', () => {
  it('should queue the media download for a message sent from the phone', async () => {
    arrangeHappy()

    expectOk(
      await WhatsAppWebhookService.ingestOutboundDeviceMessage(
        baseInbound({
          type: 'IMAGE',
          text: undefined,
          rawMediaUrl: 'https://provider.example.com/media/1',
        }),
      ),
    )

    expect(mediaAdd).toHaveBeenCalledWith(expect.any(String), {
      messageId: 'msg1',
    })
  })
})

describe('WhatsAppWebhookService.ingestInboundGroupMessage() failures', () => {
  const groupInput = (
    overrides: Partial<
      Parameters<typeof WhatsAppWebhookService.ingestInboundGroupMessage>[0]
    > = {},
  ) => ({
    connection,
    groupJid: '120363000000000000@g.us',
    senderWaId: '5511988887777',
    providerMessageId: 'gpm1',
    type: 'TEXT' as const,
    text: 'Bom dia',
    ...overrides,
  })

  function arrangeGroup() {
    mockedGroupMessageRepo.findByProviderMessageId.mockResolvedValue(ok(null))
    mockedGroupRepo.findByGroupJid.mockResolvedValue(
      ok(createFakeWhatsAppGroupWithParticipants({ id: 'g1' })),
    )
    mockedGroupRepo.create.mockResolvedValue(
      ok(createFakeWhatsAppGroupWithParticipants({ id: 'g-new' })),
    )
    mockedGroupMessageRepo.create.mockResolvedValue(
      ok(createFakeWhatsAppGroupMessage({ id: 'gm1' })),
    )
    mockedGroupRepo.update.mockResolvedValue(
      ok(createFakeWhatsAppGroupWithParticipants({ id: 'g1' })),
    )
  }

  it('should propagate a dedupe lookup failure', async () => {
    arrangeGroup()
    mockedGroupMessageRepo.findByProviderMessageId.mockResolvedValue(
      err(DB_ERROR),
    )

    expectErr(
      await WhatsAppWebhookService.ingestInboundGroupMessage(groupInput()),
      'DATABASE_ERROR',
    )
  })

  it('should propagate a group lookup failure', async () => {
    arrangeGroup()
    mockedGroupRepo.findByGroupJid.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppWebhookService.ingestInboundGroupMessage(groupInput()),
      'DATABASE_ERROR',
    )
  })

  it('should name an auto-created group from the payload', async () => {
    arrangeGroup()
    mockedGroupRepo.findByGroupJid.mockResolvedValue(ok(null))

    expectOk(
      await WhatsAppWebhookService.ingestInboundGroupMessage(
        groupInput({ groupName: '  Time Comercial  ' }),
      ),
    )

    expect(mockedGroupRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Time Comercial' }),
    )
  })

  it('should propagate a failure auto-creating the group', async () => {
    arrangeGroup()
    mockedGroupRepo.findByGroupJid.mockResolvedValue(ok(null))
    mockedGroupRepo.create.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppWebhookService.ingestInboundGroupMessage(groupInput()),
      'DATABASE_ERROR',
    )
    expect(mockedGroupMessageRepo.create).not.toHaveBeenCalled()
  })

  it('should not touch the contact book when the sender has no name', async () => {
    arrangeGroup()

    expectOk(
      await WhatsAppWebhookService.ingestInboundGroupMessage(groupInput()),
    )

    expect(mockedContactRepo.upsertByWaId).not.toHaveBeenCalled()
    expect(mockedGroupRepo.upsertParticipantName).not.toHaveBeenCalled()
  })

  it('should propagate a failure persisting the group message', async () => {
    arrangeGroup()
    mockedGroupMessageRepo.create.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppWebhookService.ingestInboundGroupMessage(groupInput()),
      'DATABASE_ERROR',
    )
    expect(mockedGroupRepo.update).not.toHaveBeenCalled()
  })
})

describe('WhatsAppWebhookService reaction and status failures', () => {
  it('should clear a reaction removed by the contact', async () => {
    mockedMessageRepo.updateReactionByProviderMessageId.mockResolvedValue(
      ok(createFakeWhatsAppMessage({ id: 'm1', workspaceId: 'ws1' })),
    )

    expectOk(
      await WhatsAppWebhookService.ingestInboundReaction({
        providerMessageId: 'wamid-1',
        emoji: '',
      }),
    )

    expect(
      mockedMessageRepo.updateReactionByProviderMessageId,
    ).toHaveBeenCalledWith('wamid-1', { emoji: null, reactedByContact: true })
  })

  it('should propagate a reaction update failure', async () => {
    mockedMessageRepo.updateReactionByProviderMessageId.mockResolvedValue(
      err(DB_ERROR),
    )

    expectErr(
      await WhatsAppWebhookService.ingestInboundReaction({
        providerMessageId: 'wamid-1',
        emoji: '👍',
      }),
      'DATABASE_ERROR',
    )
  })

  it('should propagate a status update failure', async () => {
    mockedMessageRepo.updateStatusByProviderMessageId.mockResolvedValue(
      err(DB_ERROR),
    )

    expectErr(
      await WhatsAppWebhookService.ingestStatusUpdate({
        providerMessageId: 'wamid-1',
        status: 'READ',
      }),
      'DATABASE_ERROR',
    )
    expect(publishWhatsAppEvent).not.toHaveBeenCalled()
  })
})
