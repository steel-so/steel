import { describe, expect, it } from 'vitest'
import { StartWhatsAppPhoneCallSchema } from '@/src/schemas/whatsapp-phone-call.schema'

describe('StartWhatsAppPhoneCallSchema', () => {
  it('defaults to a direct call', () => {
    expect(StartWhatsAppPhoneCallSchema.parse({})).toEqual({ mode: 'DIRECT' })
  })

  it('accepts a call that starts with the recording', () => {
    expect(StartWhatsAppPhoneCallSchema.parse({ mode: 'RECORDING' })).toEqual({
      mode: 'RECORDING',
    })
  })

  it('rejects an unknown mode', () => {
    expect(StartWhatsAppPhoneCallSchema.safeParse({ mode: 'X' }).success).toBe(
      false,
    )
  })
})
