import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppAgentPresence } from '@/src/__tests__/factories/whatsapp-agent-presence.factory'
import { toWhatsAppPresenceDTO } from '../whatsapp-presence.mapper'

describe('toWhatsAppPresenceDTO()', () => {
  it('maps a saved row', () => {
    const row = createFakeWhatsAppAgentPresence({
      userId: 'u1',
      status: 'AWAY',
      updatedAt: new Date('2026-10-22T12:00:00Z'),
    })
    expect(toWhatsAppPresenceDTO('u1', row)).toEqual({
      userId: 'u1',
      status: 'AWAY',
      updatedAt: '2026-10-22T12:00:00.000Z',
    })
  })

  it.each([null, undefined])(
    'is available when there is no row (%s)',
    (row) => {
      expect(toWhatsAppPresenceDTO('u1', row)).toEqual({
        userId: 'u1',
        status: 'AVAILABLE',
        updatedAt: null,
      })
    },
  )
})
