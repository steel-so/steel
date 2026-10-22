import { describe, expect, it } from 'vitest'
import {
  CreateWhatsAppPriceSchema,
  UpdateWhatsAppCostSettingsSchema,
  WhatsAppCostQuerySchema,
} from '../whatsapp-cost.schema'

describe('WhatsAppCostQuerySchema', () => {
  it('accepts an inclusive range with an optional connection', () => {
    const parsed = WhatsAppCostQuerySchema.parse({
      from: '2026-10-01',
      to: '2026-10-31',
      connectionId: 'c1',
    })
    expect(parsed.connectionId).toBe('c1')
    expect(
      WhatsAppCostQuerySchema.safeParse({
        from: '2026-10-05',
        to: '2026-10-05',
      }).success,
    ).toBe(true)
  })

  it.each([
    [{ from: '01/10/2026', to: '2026-10-31' }],
    [{ from: '2026-10-31', to: '2026-10-01' }],
    [{ from: '2025-01-01', to: '2026-10-01' }],
    [{ from: '2026-10-01', to: '2026-10-31', connectionId: '' }],
  ])('rejects %j', (input) => {
    expect(WhatsAppCostQuerySchema.safeParse(input).success).toBe(false)
  })
})

describe('CreateWhatsAppPriceSchema', () => {
  it('defaults the country to BR and normalizes case', () => {
    expect(
      CreateWhatsAppPriceSchema.parse({ category: 'UTILITY', unitPrice: 0.04 })
        .country,
    ).toBe('BR')
    expect(
      CreateWhatsAppPriceSchema.parse({
        category: 'MARKETING',
        country: ' us ',
        unitPrice: 1,
        validFrom: '2026-12-01T00:00:00.000Z',
      }).country,
    ).toBe('US')
  })

  it.each([
    [{ category: 'SERVICE', unitPrice: 1 }],
    [{ category: 'UTILITY', unitPrice: -1 }],
    [{ category: 'UTILITY', unitPrice: 5000 }],
    [{ category: 'UTILITY', unitPrice: 1, country: 'BRA' }],
    [{ category: 'UTILITY', unitPrice: 1, validFrom: 'ontem' }],
  ])('rejects %j', (input) => {
    expect(CreateWhatsAppPriceSchema.safeParse(input).success).toBe(false)
  })
})

describe('UpdateWhatsAppCostSettingsSchema', () => {
  it('allows omitted, null and numeric values', () => {
    expect(UpdateWhatsAppCostSettingsSchema.parse({})).toEqual({})
    expect(
      UpdateWhatsAppCostSettingsSchema.parse({
        monthlyCostBudget: null,
        connectionFees: [{ connectionId: 'c', monthlyFee: 199.9 }],
      }),
    ).toEqual({
      monthlyCostBudget: null,
      connectionFees: [{ connectionId: 'c', monthlyFee: 199.9 }],
    })
  })

  it.each([
    [{ monthlyCostBudget: -1 }],
    [{ monthlyCostBudget: 99_000_000 }],
    [{ connectionFees: [{ connectionId: '', monthlyFee: 1 }] }],
    [{ connectionFees: [{ connectionId: 'c', monthlyFee: -5 }] }],
  ])('rejects %j', (input) => {
    expect(UpdateWhatsAppCostSettingsSchema.safeParse(input).success).toBe(
      false,
    )
  })
})
