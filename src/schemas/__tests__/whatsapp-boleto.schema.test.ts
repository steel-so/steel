import { describe, expect, it } from 'vitest'
import {
  CreateWhatsAppBoletoChargeSchema,
  UpdateWhatsAppBoletoSettingsSchema,
} from '../whatsapp-boleto.schema'

const valid = {
  amount: 250.456,
  description: ' Mensalidade ',
  payerName: 'Maria',
  payerTaxId: '111.444.777-35',
}

describe('CreateWhatsAppBoletoChargeSchema', () => {
  it('rounds the amount, trims text, strips the tax id and defaults the due days', () => {
    const parsed = CreateWhatsAppBoletoChargeSchema.parse(valid)
    expect(parsed.amount).toBe(250.46)
    expect(parsed.description).toBe('Mensalidade')
    expect(parsed.payerTaxId).toBe('11144477735')
    expect(parsed.dueInDays).toBe(3)
  })

  it('accepts a CNPJ and rejects other lengths', () => {
    expect(
      CreateWhatsAppBoletoChargeSchema.safeParse({
        ...valid,
        payerTaxId: '11.222.333/0001-81',
      }).success,
    ).toBe(true)
    expect(
      CreateWhatsAppBoletoChargeSchema.safeParse({ ...valid, payerTaxId: '123' })
        .success,
    ).toBe(false)
  })

  it('enforces amount, description and due-day limits', () => {
    for (const bad of [
      { amount: 0.5 },
      { amount: 1_000_000 },
      { description: '' },
      { description: 'x'.repeat(141) },
      { payerName: 'A' },
      { dueInDays: 0 },
      { dueInDays: 91 },
    ]) {
      expect(
        CreateWhatsAppBoletoChargeSchema.safeParse({ ...valid, ...bad }).success,
      ).toBe(false)
    }
  })
})

describe('UpdateWhatsAppBoletoSettingsSchema', () => {
  it('takes an optional switch', () => {
    expect(UpdateWhatsAppBoletoSettingsSchema.parse({})).toEqual({})
    expect(UpdateWhatsAppBoletoSettingsSchema.parse({ enabled: true })).toEqual({
      enabled: true,
    })
    expect(
      UpdateWhatsAppBoletoSettingsSchema.safeParse({ enabled: 'yes' }).success,
    ).toBe(false)
  })
})
