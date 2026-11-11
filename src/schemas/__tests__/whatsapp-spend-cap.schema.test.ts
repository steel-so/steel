import { describe, expect, it } from 'vitest'
import {
  UpdateWhatsAppSpendCapSchema,
  WHATSAPP_SPEND_CAP_MAX,
  WhatsAppSpendCapQuerySchema,
} from '../whatsapp-spend-cap.schema'

describe('UpdateWhatsAppSpendCapSchema', () => {
  it('accepts a cap with a mode and null to remove it', () => {
    expect(
      UpdateWhatsAppSpendCapSchema.parse({
        monthlyCapAmount: 1500,
        capMode: 'BLOCK',
      }),
    ).toEqual({ monthlyCapAmount: 1500, capMode: 'BLOCK' })
    expect(
      UpdateWhatsAppSpendCapSchema.parse({
        monthlyCapAmount: null,
        capMode: 'WARN',
      }).monthlyCapAmount,
    ).toBeNull()
  })

  it.each([
    [{ monthlyCapAmount: 0, capMode: 'BLOCK' }, 'maior que zero'],
    [{ monthlyCapAmount: -5, capMode: 'WARN' }, 'maior que zero'],
    [
      { monthlyCapAmount: WHATSAPP_SPEND_CAP_MAX + 1, capMode: 'WARN' },
      'Máximo',
    ],
    [{ monthlyCapAmount: 10, capMode: 'STOP' }, 'só avisar ou bloquear'],
    [{ capMode: 'WARN' }, ''],
  ])('rejects %o', (input, message) => {
    const parsed = UpdateWhatsAppSpendCapSchema.safeParse(input)
    expect(parsed.success).toBe(false)
    if (!parsed.success && message) {
      expect(parsed.error.issues[0].message).toContain(message)
    }
  })
})

describe('WhatsAppSpendCapQuerySchema', () => {
  it('takes an optional connection', () => {
    expect(WhatsAppSpendCapQuerySchema.parse({})).toEqual({})
    expect(
      WhatsAppSpendCapQuerySchema.parse({ connectionId: 'c1' }).connectionId,
    ).toBe('c1')
    expect(
      WhatsAppSpendCapQuerySchema.safeParse({ connectionId: '' }).success,
    ).toBe(false)
  })
})
