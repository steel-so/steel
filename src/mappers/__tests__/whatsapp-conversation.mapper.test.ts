import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { toWhatsAppConversationDTO } from '../whatsapp-conversation.mapper'

describe('toWhatsAppConversationDTO()', () => {
  it('should map contact fields onto the conversation DTO', () => {
    const contact = createFakeWhatsAppContact({
      name: 'Maria Silva',
      waId: '5511988887777',
      avatarUrl: null,
    })
    const conversation = createFakeWhatsAppConversationWithPreview({
      contact,
      messages: [],
    })

    const dto = toWhatsAppConversationDTO(conversation)

    expect(dto.contactName).toBe('Maria Silva')
    expect(dto.contactWaId).toBe('5511988887777')
    expect(dto.lastMessagePreview).toBeNull()
  })

  it('should use the last message text as the preview', () => {
    const lastMessage = createFakeWhatsAppMessage({
      type: 'TEXT',
      text: 'Até mais tarde!',
    })
    const conversation = createFakeWhatsAppConversationWithPreview({
      messages: [lastMessage],
    })

    const dto = toWhatsAppConversationDTO(conversation)

    expect(dto.lastMessagePreview).toBe('Até mais tarde!')
  })

  it('should fall back to a type label when the last message has no text', () => {
    const lastMessage = createFakeWhatsAppMessage({ type: 'AUDIO', text: null })
    const conversation = createFakeWhatsAppConversationWithPreview({
      messages: [lastMessage],
    })

    const dto = toWhatsAppConversationDTO(conversation)

    expect(dto.lastMessagePreview).toContain('Áudio')
  })

  it('should serialize lastMessageAt as null when the conversation has no messages yet', () => {
    const conversation = createFakeWhatsAppConversationWithPreview({
      lastMessageAt: null,
      messages: [],
    })

    const dto = toWhatsAppConversationDTO(conversation)

    expect(dto.lastMessageAt).toBeNull()
  })

  it('should map avgSentimentScore through, null by default', () => {
    const withoutSentiment = createFakeWhatsAppConversationWithPreview()
    expect(
      toWhatsAppConversationDTO(withoutSentiment).avgSentimentScore,
    ).toBeNull()

    const withSentiment = createFakeWhatsAppConversationWithPreview({
      avgSentimentScore: 0.42,
    })
    expect(toWhatsAppConversationDTO(withSentiment).avgSentimentScore).toBe(
      0.42,
    )
  })

  it.each([
    ['IMAGE', '📷 Imagem'],
    ['AUDIO', '🎤 Áudio'],
    ['VIDEO', '🎥 Vídeo'],
    ['DOCUMENT', '📄 Documento'],
    ['STICKER', 'Figurinha'],
    ['LOCATION', '📍 Localização'],
    ['TEMPLATE', 'Template'],
    ['BUTTON', 'Botão'],
    ['CONTACT', ''],
  ] as const)('should label a text-less %s message as "%s"', (type, label) => {
    const conversation = createFakeWhatsAppConversationWithPreview({
      messages: [createFakeWhatsAppMessage({ type, text: null })],
    })

    expect(toWhatsAppConversationDTO(conversation).lastMessagePreview).toBe(
      label,
    )
  })

  it('should serialize lifecycle flags and timestamps', () => {
    const closedAt = new Date('2026-09-01T10:00:00.000Z')
    const lastMessageAt = new Date('2026-09-01T09:00:00.000Z')
    const conversation = createFakeWhatsAppConversationWithPreview({
      pinnedAt: new Date(),
      archivedAt: new Date(),
      closedAt,
      lastMessageAt,
      closeReason: 'RESOLVED',
      messages: [],
    })

    const dto = toWhatsAppConversationDTO(conversation)

    expect(dto.pinned).toBe(true)
    expect(dto.archived).toBe(true)
    expect(dto.closedAt).toBe(closedAt.toISOString())
    expect(dto.lastMessageAt).toBe(lastMessageAt.toISOString())
    expect(dto.closeReason).toBe('RESOLVED')
  })

  it('should serialize lastInboundAt, null when the contact never wrote', () => {
    const never = createFakeWhatsAppConversationWithPreview()
    expect(toWhatsAppConversationDTO(never).lastInboundAt).toBeNull()

    const wrote = createFakeWhatsAppConversationWithPreview({
      lastInboundAt: new Date('2026-11-13T10:00:00.000Z'),
    })
    expect(toWhatsAppConversationDTO(wrote).lastInboundAt).toBe(
      '2026-11-13T10:00:00.000Z',
    )
  })
})
