import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
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
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: {
    text: vi.fn(async () => ({
      ok: true,
      value: { providerMessageId: 'pm1' },
    })),
    media: vi.fn(async () => ({
      ok: true,
      value: { providerMessageId: 'pm2' },
    })),
    template: vi.fn(async () => ({
      ok: true,
      value: { providerMessageId: 'pm3' },
    })),
    contact: vi.fn(async () => ({
      ok: true,
      value: { providerMessageId: 'pm4' },
    })),
    reaction: vi.fn(async () => ({ ok: true, value: undefined })),
  },
}))

import { whatsappOutsideBusinessHours } from '@/src/errors'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppBusinessHoursService } from '@/src/services/whatsapp-business-hours.service'
import { WhatsAppSlaService } from '@/src/services/whatsapp-sla.service'
import { WhatsAppMessageService } from '../whatsapp-message.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedContactRepo = vi.mocked(WhatsAppContactRepository)
const mockedConversationRepo = vi.mocked(WhatsAppConversationRepository)
const mockedMessageRepo = vi.mocked(WhatsAppMessageRepository)
const mockedSend = vi.mocked(WhatsAppSend)

function mockSendableConversation(overrides: { aiActive?: boolean } = {}) {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  const conversation = createFakeWhatsAppConversationWithPreview({
    id: 'conv1',
    workspaceId: 'ws1',
    connectionId: 'conn1',
    aiActive: overrides.aiActive ?? false,
  })
  const connection = createFakeWhatsAppConnection({
    id: 'conn1',
    workspaceId: 'ws1',
  })
  mockedConversationRepo.findById.mockResolvedValue(ok(conversation))
  mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
  return { conversation, connection }
}

describe('WhatsAppMessageService', () => {
  describe('sendText()', () => {
    it('should send the text message and persist it as OUT', async () => {
      mockSendableConversation()
      const created = createFakeWhatsAppMessage({
        direction: 'OUT',
        text: 'Olá!',
      })
      mockedMessageRepo.create.mockResolvedValue(ok(created))
      mockedConversationRepo.update.mockResolvedValue(
        ok(createFakeWhatsAppConversationWithPreview()),
      )

      const result = await WhatsAppMessageService.sendText(
        'u1',
        'ws1',
        'conv1',
        { text: 'Olá!' },
      )

      const dto = expectOk(result)
      expect(dto.direction).toBe('OUT')
      expect(mockedSend.text).toHaveBeenCalled()
      expect(mockedMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'OUT',
          type: 'TEXT',
          text: 'Olá!',
          senderUserId: 'u1',
          providerMessageId: 'pm1',
        }),
      )
      // The first human answer closes the SLA first-response clock.
      expect(WhatsAppSlaService.onOutbound).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        conversationId: 'conv1',
        senderUserId: 'u1',
        byAi: false,
      })
    })

    it('should block sending while the AI is handling the conversation', async () => {
      mockSendableConversation({ aiActive: true })

      const result = await WhatsAppMessageService.sendText(
        'u1',
        'ws1',
        'conv1',
        { text: 'Olá!' },
      )

      expectErr(result, 'WHATSAPP_CONVERSATION_AI_HANDLING')
      expect(mockedSend.text).not.toHaveBeenCalled()
      expect(mockedMessageRepo.create).not.toHaveBeenCalled()
    })

    it('should lock the agent send outside business hours', async () => {
      mockSendableConversation()
      vi.mocked(WhatsAppBusinessHoursService.assertOpen).mockResolvedValueOnce(
        err(whatsappOutsideBusinessHours()),
      )

      expectErr(
        await WhatsAppMessageService.sendText('u1', 'ws1', 'conv1', {
          text: 'Olá!',
        }),
        'WHATSAPP_OUTSIDE_BUSINESS_HOURS',
      )
      expect(mockedSend.text).not.toHaveBeenCalled()
    })

    it('should not persist a message when the provider send fails', async () => {
      mockSendableConversation()
      mockedSend.text.mockResolvedValueOnce({
        ok: false,
        error: { code: 'WHATSAPP_PROVIDER_ERROR', message: 'timeout' },
      })

      const result = await WhatsAppMessageService.sendText(
        'u1',
        'ws1',
        'conv1',
        { text: 'Olá!' },
      )

      expectErr(result, 'WHATSAPP_PROVIDER_ERROR')
      expect(mockedMessageRepo.create).not.toHaveBeenCalled()
    })
  })

  describe('sendMedia()', () => {
    it('should send media and persist it with the mediaUrl', async () => {
      mockSendableConversation()
      const created = createFakeWhatsAppMessage({
        direction: 'OUT',
        type: 'IMAGE',
        mediaUrl: 'https://minio.internal/whatsapp-media/img.jpg',
      })
      mockedMessageRepo.create.mockResolvedValue(ok(created))
      mockedConversationRepo.update.mockResolvedValue(
        ok(createFakeWhatsAppConversationWithPreview()),
      )

      const result = await WhatsAppMessageService.sendMedia(
        'u1',
        'ws1',
        'conv1',
        {
          mediaUrl: 'https://minio.internal/whatsapp-media/img.jpg',
          type: 'IMAGE',
        },
      )

      const dto = expectOk(result)
      expect(dto.mediaUrl).toBe('https://minio.internal/whatsapp-media/img.jpg')
      expect(mockedSend.media).toHaveBeenCalled()
    })
  })

  describe('sendText() with a reply target', () => {
    it('should resolve the quoted message and pass its providerMessageId', async () => {
      mockSendableConversation()
      mockedMessageRepo.findById.mockResolvedValue(
        ok(
          createFakeWhatsAppMessage({
            id: 'quoted1',
            providerMessageId: 'pm-quoted',
          }),
        ),
      )
      mockedMessageRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppMessage({ replyToMessageId: 'quoted1' })),
      )
      mockedConversationRepo.update.mockResolvedValue(
        ok(createFakeWhatsAppConversationWithPreview()),
      )

      await WhatsAppMessageService.sendText('u1', 'ws1', 'conv1', {
        text: 'Respondendo',
        replyToMessageId: 'quoted1',
      })

      expect(mockedSend.text).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ quotedProviderMessageId: 'pm-quoted' }),
        { cost: expect.objectContaining({ source: 'AGENT' }) },
      )
      expect(mockedMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ replyToMessageId: 'quoted1' }),
      )
    })
  })

  describe('react()', () => {
    it('should send the reaction and persist it on the target message', async () => {
      mockSendableConversation()
      mockedMessageRepo.findById.mockResolvedValue(
        ok(
          createFakeWhatsAppMessage({
            id: 'msg1',
            conversationId: 'conv1',
            providerMessageId: 'pm1',
          }),
        ),
      )
      mockedMessageRepo.update.mockResolvedValue(
        ok(
          createFakeWhatsAppMessage({
            id: 'msg1',
            reactionEmoji: '👍',
            reactedByContact: false,
          }),
        ),
      )

      const result = await WhatsAppMessageService.react(
        'u1',
        'ws1',
        'conv1',
        'msg1',
        { emoji: '👍' },
      )

      const dto = expectOk(result)
      expect(dto.reactionEmoji).toBe('👍')
      expect(mockedSend.reaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ providerMessageId: 'pm1', emoji: '👍' }),
      )
      expect(mockedMessageRepo.update).toHaveBeenCalledWith('msg1', {
        reactionEmoji: '👍',
        reactedByContact: false,
      })
    })

    it('should return WHATSAPP_MESSAGE_NOT_FOUND for a message in another conversation', async () => {
      mockSendableConversation()
      mockedMessageRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppMessage({ id: 'msg1', conversationId: 'other' })),
      )

      const result = await WhatsAppMessageService.react(
        'u1',
        'ws1',
        'conv1',
        'msg1',
        { emoji: '👍' },
      )

      expectErr(result, 'WHATSAPP_MESSAGE_NOT_FOUND')
      expect(mockedSend.reaction).not.toHaveBeenCalled()
    })
  })

  describe('sendContact()', () => {
    it('should send a shared contact card and persist it with the payload', async () => {
      mockSendableConversation()
      mockedContactRepo.findById.mockResolvedValue(
        ok(
          createFakeWhatsAppContact({
            id: 'shared1',
            waId: '5511977776666',
            name: 'João',
          }),
        ),
      )
      const created = createFakeWhatsAppMessage({
        direction: 'OUT',
        type: 'CONTACT',
        contactPayload: { name: 'João', waId: '5511977776666' },
      })
      mockedMessageRepo.create.mockResolvedValue(ok(created))
      mockedConversationRepo.update.mockResolvedValue(
        ok(createFakeWhatsAppConversationWithPreview()),
      )

      const result = await WhatsAppMessageService.sendContact(
        'u1',
        'ws1',
        'conv1',
        { contactId: 'shared1' },
      )

      const dto = expectOk(result)
      expect(dto.type).toBe('CONTACT')
      expect(mockedSend.contact).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'João',
          waId: '5511977776666',
        }),
        { cost: expect.objectContaining({ source: 'AGENT' }) },
      )
      expect(mockedMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CONTACT',
          contactPayload: { name: 'João', waId: '5511977776666' },
        }),
      )
    })

    it('should return WHATSAPP_CONTACT_NOT_FOUND for an unknown contact', async () => {
      mockSendableConversation()
      mockedContactRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppMessageService.sendContact(
        'u1',
        'ws1',
        'conv1',
        { contactId: 'unknown' },
      )

      expectErr(result, 'WHATSAPP_CONTACT_NOT_FOUND')
      expect(mockedSend.contact).not.toHaveBeenCalled()
    })
  })

  describe('remove()', () => {
    it('should soft-delete a message belonging to the conversation', async () => {
      mockSendableConversation()
      mockedMessageRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppMessage({ id: 'msg1', conversationId: 'conv1' })),
      )
      mockedMessageRepo.update.mockResolvedValue(
        ok(createFakeWhatsAppMessage({ id: 'msg1' })),
      )

      const result = await WhatsAppMessageService.remove(
        'u1',
        'ws1',
        'conv1',
        'msg1',
      )

      const value = expectOk(result)
      expect(value).toEqual({ id: 'msg1' })
      expect(mockedMessageRepo.update).toHaveBeenCalledWith('msg1', {
        deletedAt: expect.any(Date),
      })
    })

    it('should return WHATSAPP_MESSAGE_NOT_FOUND for a message in another conversation', async () => {
      mockSendableConversation()
      mockedMessageRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppMessage({ id: 'msg1', conversationId: 'other' })),
      )

      const result = await WhatsAppMessageService.remove(
        'u1',
        'ws1',
        'conv1',
        'msg1',
      )

      expectErr(result, 'WHATSAPP_MESSAGE_NOT_FOUND')
      expect(mockedMessageRepo.update).not.toHaveBeenCalled()
    })
  })

  describe('list()', () => {
    it('should return the conversation history', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedConversationRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppConversationWithPreview({ id: 'conv1' })),
      )
      mockedMessageRepo.listByConversation.mockResolvedValue(
        ok([createFakeWhatsAppMessage(), createFakeWhatsAppMessage()]),
      )

      const result = await WhatsAppMessageService.list('u1', 'ws1', 'conv1', {
        limit: 50,
      })

      const dtos = expectOk(result)
      expect(dtos).toHaveLength(2)
    })

    it('should return WHATSAPP_CONVERSATION_NOT_FOUND for an unknown conversation', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedConversationRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppMessageService.list('u1', 'ws1', 'conv1', {
        limit: 50,
      })

      expectErr(result, 'WHATSAPP_CONVERSATION_NOT_FOUND')
    })
  })
})
