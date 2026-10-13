import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppPhoneCall } from '@/src/__tests__/factories/whatsapp-phone-call.factory'
import { toWhatsAppPhoneCallDTO } from '../whatsapp-phone-call.mapper'

describe('toWhatsAppPhoneCallDTO()', () => {
  it('maps a finished call without leaking the callback hash', () => {
    const answeredAt = new Date('2026-10-13T12:00:00.000Z')
    const endedAt = new Date('2026-10-13T12:00:42.000Z')
    const call = createFakeWhatsAppPhoneCall({
      status: 'COMPLETED',
      answeredAt,
      endedAt,
      durationSeconds: 42,
    })

    const dto = toWhatsAppPhoneCallDTO(call)

    expect(dto).toEqual({
      id: call.id,
      conversationId: call.conversationId,
      userId: call.userId,
      extension: '200',
      destination: '11999999999',
      status: 'COMPLETED',
      answeredAt: '2026-10-13T12:00:00.000Z',
      endedAt: '2026-10-13T12:00:42.000Z',
      durationSeconds: 42,
      createdAt: call.createdAt.toISOString(),
    })
    expect(dto).not.toHaveProperty('callbackTokenHash')
  })

  it('keeps the open timestamps null', () => {
    const dto = toWhatsAppPhoneCallDTO(createFakeWhatsAppPhoneCall())
    expect(dto).toMatchObject({ answeredAt: null, endedAt: null })
  })
})
