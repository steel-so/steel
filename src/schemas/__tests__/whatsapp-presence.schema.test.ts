import { describe, expect, it } from 'vitest'
import { SetWhatsAppPresenceSchema } from '../whatsapp-presence.schema'

describe('SetWhatsAppPresenceSchema', () => {
  it.each(['AVAILABLE', 'AWAY'])('accepts %s', (status) => {
    expect(SetWhatsAppPresenceSchema.safeParse({ status }).success).toBe(true)
  })

  it.each([{}, { status: 'BUSY' }, { status: '' }, { status: null }])(
    'rejects %j',
    (body) => {
      const parsed = SetWhatsAppPresenceSchema.safeParse(body)
      expect(parsed.success).toBe(false)
    },
  )

  it('explains the choice in Portuguese', () => {
    const parsed = SetWhatsAppPresenceSchema.safeParse({ status: 'BUSY' })
    expect(parsed.success ? '' : parsed.error.issues[0].message).toBe(
      'Escolha Disponível ou Ausente',
    )
  })
})
