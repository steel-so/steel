import { describe, expect, it } from 'vitest'
import {
  CreateWhatsAppPixChargeSchema,
  MockPixWebhookSchema,
  PIX_DESCRIPTION_MAX,
  UpdateWhatsAppPixSettingsSchema,
} from '../whatsapp-pix.schema'

describe('CreateWhatsAppPixChargeSchema', () => {
  it('accepts a charge and rounds the amount to the cent', () => {
    const parsed = CreateWhatsAppPixChargeSchema.parse({
      amount: 10.005,
      description: '  Mensalidade  ',
    })
    expect(parsed.amount).toBe(10.01)
    expect(parsed.description).toBe('Mensalidade')
    expect(parsed.expiresInMinutes).toBeUndefined()
  })

  it('accepts expiry and opportunity', () => {
    expect(
      CreateWhatsAppPixChargeSchema.safeParse({
        amount: 1,
        description: 'x',
        expiresInMinutes: 30,
        opportunityId: 'opp1',
      }).success,
    ).toBe(true)
  })

  it.each([
    [{ amount: 0, description: 'x' }, 'O valor mínimo é R$ 0,01'],
    [{ amount: 1_000_000, description: 'x' }, 'O valor máximo é R$ 999.999,99'],
    [{ amount: '10', description: 'x' }, 'Informe o valor da cobrança'],
    [{ amount: 10, description: '   ' }, 'Descreva o que está sendo cobrado'],
    [
      { amount: 10, description: 'a'.repeat(PIX_DESCRIPTION_MAX + 1) },
      `A descrição pode ter até ${PIX_DESCRIPTION_MAX} caracteres`,
    ],
    [
      { amount: 10, description: 'x', expiresInMinutes: 4 },
      'O mínimo é de 5 min',
    ],
    [
      { amount: 10, description: 'x', expiresInMinutes: 10_081 },
      'O máximo é de 7 dias',
    ],
    [
      { amount: 10, description: 'x', expiresInMinutes: 10.5 },
      'Informe um número inteiro de minutos',
    ],
  ])('rejects %j', (input, message) => {
    const result = CreateWhatsAppPixChargeSchema.safeParse(input)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe(message)
  })
})

describe('UpdateWhatsAppPixSettingsSchema', () => {
  it('accepts a partial update', () => {
    expect(UpdateWhatsAppPixSettingsSchema.parse({})).toEqual({})
    expect(
      UpdateWhatsAppPixSettingsSchema.parse({
        enabled: true,
        defaultExpiresMinutes: 45,
      }),
    ).toEqual({ enabled: true, defaultExpiresMinutes: 45 })
  })

  it('rejects an out of range expiry', () => {
    expect(
      UpdateWhatsAppPixSettingsSchema.safeParse({ defaultExpiresMinutes: 1 })
        .success,
    ).toBe(false)
  })
})

describe('MockPixWebhookSchema', () => {
  it('requires the charge id and the amount', () => {
    expect(
      MockPixWebhookSchema.safeParse({ providerChargeId: 'a', paidAmount: 1 })
        .success,
    ).toBe(true)
    expect(MockPixWebhookSchema.safeParse({ paidAmount: 1 }).success).toBe(
      false,
    )
    expect(
      MockPixWebhookSchema.safeParse({
        providerChargeId: 'a',
        paidAmount: 1,
        paidAt: 'yesterday',
      }).success,
    ).toBe(false)
  })
})
