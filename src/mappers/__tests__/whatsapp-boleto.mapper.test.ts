import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppBoletoCharge } from '@/src/__tests__/factories/nov-pix-abacatepay.factory'
import {
  effectiveBoletoStatus,
  toWhatsAppBoletoChargeDTO,
  toWhatsAppBoletoSettingsDTO,
} from '../whatsapp-boleto.mapper'

describe('whatsapp boleto mapper', () => {
  it('maps a pending charge', () => {
    const charge = createFakeWhatsAppBoletoCharge()
    const dto = toWhatsAppBoletoChargeDTO(charge)
    expect(dto).toMatchObject({
      id: charge.id,
      amount: 250,
      status: 'PENDING',
      paidAmount: null,
      paidAt: null,
      canceledAt: null,
      url: charge.url,
    })
    expect(dto.dueAt).toBe(charge.dueAt.toISOString())
  })

  it('derives EXPIRED from the due date and maps paid values', () => {
    const past = createFakeWhatsAppBoletoCharge({ dueAt: new Date(0) })
    expect(effectiveBoletoStatus(past)).toBe('EXPIRED')
    const paid = createFakeWhatsAppBoletoCharge({
      status: 'PAID',
      dueAt: new Date(0),
      paidAt: new Date(5),
      paidAmount: 250 as never,
      canceledAt: new Date(6),
    })
    const dto = toWhatsAppBoletoChargeDTO(paid)
    expect(dto.status).toBe('PAID')
    expect(dto.paidAmount).toBe(250)
    expect(dto.paidAt).toBe(new Date(5).toISOString())
    expect(dto.canceledAt).toBe(new Date(6).toISOString())
  })

  it('maps the settings', () => {
    expect(
      toWhatsAppBoletoSettingsDTO('ws', true, { id: 'mock', isTest: true }),
    ).toEqual({
      workspaceId: 'ws',
      enabled: true,
      provider: 'mock',
      isTestProvider: true,
    })
  })
})
