import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { toWhatsAppMessageDTO } from '../whatsapp-message.mapper'

describe('toWhatsAppMessageDTO()', () => {
  it('should map all fields correctly', () => {
    const message = createFakeWhatsAppMessage({
      id: 'm1',
      direction: 'OUT',
      type: 'TEXT',
      text: 'Olá!',
      status: 'SENT',
      sentByAi: true,
    })

    const dto = toWhatsAppMessageDTO(message)

    expect(dto).toEqual({
      id: 'm1',
      workspaceId: message.workspaceId,
      conversationId: message.conversationId,
      direction: 'OUT',
      type: 'TEXT',
      text: 'Olá!',
      mediaUrl: null,
      status: 'SENT',
      senderUserId: null,
      sentByAi: true,
      replyToMessageId: null,
      reactionEmoji: null,
      reactedByContact: null,
      contactPayload: null,
      buttons: null,
      buttonPayload: null,
      createdAt: message.createdAt.toISOString(),
    })
  })

  it('should preserve mediaUrl for media messages', () => {
    const message = createFakeWhatsAppMessage({
      type: 'IMAGE',
      text: null,
      mediaUrl: 'https://minio.internal/whatsapp-media/img.jpg',
    })

    const dto = toWhatsAppMessageDTO(message)

    expect(dto.mediaUrl).toBe('https://minio.internal/whatsapp-media/img.jpg')
    expect(dto.text).toBeNull()
  })
})
