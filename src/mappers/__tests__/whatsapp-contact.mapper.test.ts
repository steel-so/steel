import { describe, expect, it } from 'vitest'
import {
  createFakeWhatsAppContact,
  createFakeWhatsAppContactWithoutCount,
} from '@/src/__tests__/factories/whatsapp-contact.factory'
import { toWhatsAppContactDTO } from '../whatsapp-contact.mapper'

describe('toWhatsAppContactDTO()', () => {
  it('should map all fields correctly', () => {
    const contact = createFakeWhatsAppContact({
      id: 'ct1',
      waId: '5511988887777',
      name: 'Maria Silva',
      avatarUrl: 'https://minio.internal/avatars/ct1.jpg',
    })

    const dto = toWhatsAppContactDTO(contact)

    expect(dto).toEqual({
      id: 'ct1',
      workspaceId: contact.workspaceId,
      waId: '5511988887777',
      name: 'Maria Silva',
      avatarUrl: 'https://minio.internal/avatars/ct1.jpg',
      description: null,
      broadcastOptedOutAt: null,
      broadcastOptOutSource: null,
      hasWhatsapp: null,
      whatsappCheckedAt: null,
      conversationCount: 0,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    })
  })

  it('should keep name and avatarUrl as null when unset', () => {
    const contact = createFakeWhatsAppContact({ name: null, avatarUrl: null })

    const dto = toWhatsAppContactDTO(contact)

    expect(dto.name).toBeNull()
    expect(dto.avatarUrl).toBeNull()
  })

  it('should expose the broadcast opt-out state', () => {
    const optedOutAt = new Date('2026-09-01T12:00:00.000Z')
    const contact = createFakeWhatsAppContact({
      broadcastOptedOutAt: optedOutAt,
      broadcastOptOutSource: 'KEYWORD',
    })

    const dto = toWhatsAppContactDTO(contact)

    expect(dto.broadcastOptedOutAt).toBe('2026-09-01T12:00:00.000Z')
    expect(dto.broadcastOptOutSource).toBe('KEYWORD')
  })

  it('should expose the conversation count when included', () => {
    const contact = {
      ...createFakeWhatsAppContact(),
      _count: { conversations: 3 },
    }

    expect(toWhatsAppContactDTO(contact).conversationCount).toBe(3)
  })

  it('should default the conversation count to zero when not included', () => {
    const contact = createFakeWhatsAppContactWithoutCount()

    expect(toWhatsAppContactDTO(contact).conversationCount).toBe(0)
  })

  it('should expose the "tem zap?" state', () => {
    const checkedAt = new Date('2026-10-20T10:00:00.000Z')
    const contact = createFakeWhatsAppContact({
      hasWhatsapp: true,
      whatsappCheckedAt: checkedAt,
    })

    const dto = toWhatsAppContactDTO(contact)

    expect(dto.hasWhatsapp).toBe(true)
    expect(dto.whatsappCheckedAt).toBe(checkedAt.toISOString())
  })
})
