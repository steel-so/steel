import { describe, expect, it } from 'vitest'
import { formatWaId, isWhatsAppPhone } from '@/src/lib/whatsapp/phone'

describe('whatsapp phone helpers', () => {
  it('should tell a phone from a BSUID', () => {
    expect(isWhatsAppPhone('5513991374570')).toBe(true)
    expect(isWhatsAppPhone('BR.13491208655302741918')).toBe(false)
  })

  it('should format a phone with + and a BSUID as no phone', () => {
    expect(formatWaId('5513991374570')).toBe('+5513991374570')
    expect(formatWaId('BR.13491208655302741918')).toBe('sem telefone')
  })
})
