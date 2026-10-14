import { describe, expect, it } from 'vitest'
import {
  UpdateWhatsAppUsageLimitsSchema,
  WHATSAPP_USAGE_LIMIT_MAX,
} from '../whatsapp-usage.schema'

describe('UpdateWhatsAppUsageLimitsSchema', () => {
  it('should accept positive integer limits', () => {
    expect(
      UpdateWhatsAppUsageLimitsSchema.safeParse({
        monthlyConversationLimit: 1000,
        monthlyMessageLimit: 20000,
      }).success,
    ).toBe(true)
  })

  it('should accept null (unlimited) and an empty patch', () => {
    expect(
      UpdateWhatsAppUsageLimitsSchema.safeParse({
        monthlyConversationLimit: null,
        monthlyMessageLimit: null,
      }).success,
    ).toBe(true)
    expect(UpdateWhatsAppUsageLimitsSchema.safeParse({}).success).toBe(true)
  })

  it('should reject zero, negative, fractional and too large values', () => {
    for (const value of [0, -1, 1.5, WHATSAPP_USAGE_LIMIT_MAX + 1]) {
      expect(
        UpdateWhatsAppUsageLimitsSchema.safeParse({
          monthlyMessageLimit: value,
        }).success,
      ).toBe(false)
      expect(
        UpdateWhatsAppUsageLimitsSchema.safeParse({
          monthlyConversationLimit: value,
        }).success,
      ).toBe(false)
    }
  })

  it('should reject a non-number', () => {
    expect(
      UpdateWhatsAppUsageLimitsSchema.safeParse({ monthlyMessageLimit: '10' })
        .success,
    ).toBe(false)
  })
})
