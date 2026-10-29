import { describe, expect, it } from 'vitest'
import {
  CreateWhatsAppAdSpendSchema,
  UpdateWhatsAppAdSettingsSchema,
  WhatsAppAdReportQuerySchema,
} from '../whatsapp-ad.schema'

describe('WhatsAppAdReportQuerySchema', () => {
  it('accepts an ordered range', () => {
    expect(
      WhatsAppAdReportQuerySchema.safeParse({
        from: '2026-10-01',
        to: '2026-10-31',
      }).success,
    ).toBe(true)
  })

  it('rejects a bad format, an impossible date and an inverted range', () => {
    expect(
      WhatsAppAdReportQuerySchema.safeParse({ from: '01/10', to: '2026-10-31' })
        .success,
    ).toBe(false)
    expect(
      WhatsAppAdReportQuerySchema.safeParse({
        from: '2026-13-45',
        to: '2026-10-31',
      }).success,
    ).toBe(false)
    expect(
      WhatsAppAdReportQuerySchema.safeParse({
        from: '2026-10-31',
        to: '2026-10-01',
      }).success,
    ).toBe(false)
  })

  it('caps the range at 400 days', () => {
    expect(
      WhatsAppAdReportQuerySchema.safeParse({
        from: '2025-01-01',
        to: '2026-10-01',
      }).success,
    ).toBe(false)
  })
})

describe('UpdateWhatsAppAdSettingsSchema', () => {
  it('accepts a partial update and a cleared owner', () => {
    expect(UpdateWhatsAppAdSettingsSchema.parse({})).toEqual({})
    expect(
      UpdateWhatsAppAdSettingsSchema.parse({
        leadOwnerId: null,
        enabled: true,
      }),
    ).toEqual({ leadOwnerId: null, enabled: true })
  })

  it('trims and bounds the lead source', () => {
    expect(
      UpdateWhatsAppAdSettingsSchema.parse({ leadSource: '  Zap  ' })
        .leadSource,
    ).toBe('Zap')
    expect(
      UpdateWhatsAppAdSettingsSchema.safeParse({ leadSource: '   ' }).success,
    ).toBe(false)
    expect(
      UpdateWhatsAppAdSettingsSchema.safeParse({ leadSource: 'x'.repeat(61) })
        .success,
    ).toBe(false)
  })
})

describe('CreateWhatsAppAdSpendSchema', () => {
  const valid = {
    sourceId: ' 120210000000001 ',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-10',
    amount: 150.5,
  }

  it('accepts a spend and trims the ad id', () => {
    expect(CreateWhatsAppAdSpendSchema.parse(valid).sourceId).toBe(
      '120210000000001',
    )
  })

  it('accepts a single-day period', () => {
    expect(
      CreateWhatsAppAdSpendSchema.safeParse({
        ...valid,
        periodEnd: '2026-10-01',
      }).success,
    ).toBe(true)
  })

  it('rejects an inverted period, a negative or huge amount, a blank ad', () => {
    expect(
      CreateWhatsAppAdSpendSchema.safeParse({
        ...valid,
        periodStart: '2026-10-11',
      }).success,
    ).toBe(false)
    expect(
      CreateWhatsAppAdSpendSchema.safeParse({ ...valid, amount: -1 }).success,
    ).toBe(false)
    expect(
      CreateWhatsAppAdSpendSchema.safeParse({ ...valid, amount: 1e9 }).success,
    ).toBe(false)
    expect(
      CreateWhatsAppAdSpendSchema.safeParse({ ...valid, sourceId: '  ' })
        .success,
    ).toBe(false)
  })
})
