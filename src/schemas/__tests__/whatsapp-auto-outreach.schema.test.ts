import { describe, expect, it } from 'vitest'
import { ConfigureWhatsAppAutoOutreachSchema } from '../whatsapp-auto-outreach.schema'

describe('ConfigureWhatsAppAutoOutreachSchema', () => {
  it('should accept the aggressiveness alone, from 20 to 60 seconds', () => {
    expect(
      ConfigureWhatsAppAutoOutreachSchema.safeParse({ intervalSeconds: 20 })
        .success,
    ).toBe(true)
    expect(
      ConfigureWhatsAppAutoOutreachSchema.safeParse({ intervalSeconds: 60 })
        .success,
    ).toBe(true)
  })

  it('should reject an interval outside 20–60 seconds', () => {
    expect(
      ConfigureWhatsAppAutoOutreachSchema.safeParse({ intervalSeconds: 19 })
        .success,
    ).toBe(false)
    expect(
      ConfigureWhatsAppAutoOutreachSchema.safeParse({ intervalSeconds: 61 })
        .success,
    ).toBe(false)
  })

  it('should require the connection and the template together', () => {
    expect(
      ConfigureWhatsAppAutoOutreachSchema.safeParse({ connectionId: 'c1' })
        .success,
    ).toBe(false)
    expect(
      ConfigureWhatsAppAutoOutreachSchema.safeParse({
        connectionId: 'c1',
        templateId: 't1',
      }).success,
    ).toBe(true)
  })

  it('should reject an empty body', () => {
    expect(ConfigureWhatsAppAutoOutreachSchema.safeParse({}).success).toBe(
      false,
    )
  })
})
