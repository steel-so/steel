import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppQuickReply } from '@/src/__tests__/factories/whatsapp-quick-reply.factory'
import { toWhatsAppQuickReplyDTO } from '../whatsapp-quick-reply.mapper'

describe('toWhatsAppQuickReplyDTO()', () => {
  it('should map all fields correctly', () => {
    const quickReply = createFakeWhatsAppQuickReply({
      id: 'qr1',
      shortcut: 'saudacao',
      title: 'Saudação',
      body: 'Olá! Como posso ajudar?',
    })

    const dto = toWhatsAppQuickReplyDTO(quickReply)

    expect(dto).toEqual({
      id: 'qr1',
      workspaceId: quickReply.workspaceId,
      shortcut: 'saudacao',
      title: 'Saudação',
      body: 'Olá! Como posso ajudar?',
      mediaUrl: null,
      buttons: [],
      createdAt: quickReply.createdAt.toISOString(),
      updatedAt: quickReply.updatedAt.toISOString(),
    })
  })
})
