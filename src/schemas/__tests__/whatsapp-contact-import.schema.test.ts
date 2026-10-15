import { describe, expect, it } from 'vitest'
import { ImportWhatsAppContactsSchema } from '../whatsapp-contact-import.schema'

describe('ImportWhatsAppContactsSchema', () => {
  it('accepts a csv payload', () => {
    expect(
      ImportWhatsAppContactsSchema.safeParse({ csv: 'Telefone\n5511999998888' })
        .success,
    ).toBe(true)
  })

  it('rejects empty and oversized payloads', () => {
    expect(ImportWhatsAppContactsSchema.safeParse({ csv: '' }).success).toBe(
      false,
    )
    expect(
      ImportWhatsAppContactsSchema.safeParse({ csv: 'x'.repeat(1_000_001) })
        .success,
    ).toBe(false)
  })
})
