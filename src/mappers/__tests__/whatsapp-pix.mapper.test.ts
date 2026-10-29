import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  createFakeWhatsAppPixCharge,
  createFakeWhatsAppPixSettings,
} from '@/src/__tests__/factories/nov-z1-pix-in-chat.factory'
import {
  effectivePixStatus,
  PIX_DEFAULT_EXPIRES_MINUTES,
  toWhatsAppPixChargeDTO,
  toWhatsAppPixSettingsDTO,
} from '../whatsapp-pix.mapper'

const NOW = new Date('2026-11-12T12:00:00.000Z')

describe('effectivePixStatus()', () => {
  it('reads a pending charge past its deadline as expired', () => {
    const expiresAt = new Date('2026-11-12T11:59:00.000Z')
    expect(effectivePixStatus({ status: 'PENDING', expiresAt }, NOW)).toBe(
      'EXPIRED',
    )
  })

  it('keeps every other status as stored', () => {
    const past = new Date('2020-01-01T00:00:00.000Z')
    const future = new Date('2030-01-01T00:00:00.000Z')
    expect(
      effectivePixStatus({ status: 'PENDING', expiresAt: future }, NOW),
    ).toBe('PENDING')
    expect(effectivePixStatus({ status: 'PAID', expiresAt: past }, NOW)).toBe(
      'PAID',
    )
    expect(
      effectivePixStatus({ status: 'CANCELED', expiresAt: past }, NOW),
    ).toBe('CANCELED')
  })
})

describe('toWhatsAppPixChargeDTO()', () => {
  it('maps a pending charge with numbers and ISO dates', () => {
    const charge = createFakeWhatsAppPixCharge({
      amount: new Prisma.Decimal('150.5'),
      expiresAt: new Date('2026-11-12T13:00:00.000Z'),
    })
    expect(toWhatsAppPixChargeDTO(charge, NOW)).toMatchObject({
      id: charge.id,
      amount: 150.5,
      status: 'PENDING',
      expiresAt: '2026-11-12T13:00:00.000Z',
      paidAt: null,
      paidAmount: null,
      canceledAt: null,
      brCode: charge.brCode,
    })
  })

  it('maps the payment and cancellation fields', () => {
    const paidAt = new Date('2026-11-12T11:00:00.000Z')
    const paid = createFakeWhatsAppPixCharge({
      status: 'PAID',
      paidAt,
      paidAmount: new Prisma.Decimal('99.9'),
      payerName: 'Maria',
    })
    expect(toWhatsAppPixChargeDTO(paid, NOW)).toMatchObject({
      status: 'PAID',
      paidAt: paidAt.toISOString(),
      paidAmount: 99.9,
      payerName: 'Maria',
    })

    const canceledAt = new Date('2026-11-12T11:30:00.000Z')
    const canceled = createFakeWhatsAppPixCharge({
      status: 'CANCELED',
      canceledAt,
    })
    expect(toWhatsAppPixChargeDTO(canceled, NOW).canceledAt).toBe(
      canceledAt.toISOString(),
    )
  })

  it('defaults the clock to now', () => {
    const charge = createFakeWhatsAppPixCharge({
      expiresAt: new Date(Date.now() - 1000),
    })
    expect(toWhatsAppPixChargeDTO(charge).status).toBe('EXPIRED')
  })
})

describe('toWhatsAppPixSettingsDTO()', () => {
  const provider = { id: 'mock', isTest: true }

  it('is off with the default expiry when nothing was saved', () => {
    expect(toWhatsAppPixSettingsDTO('ws1', null, provider)).toEqual({
      workspaceId: 'ws1',
      enabled: false,
      defaultExpiresMinutes: PIX_DEFAULT_EXPIRES_MINUTES,
      provider: 'mock',
      isTestProvider: true,
    })
  })

  it('maps the saved row', () => {
    const settings = createFakeWhatsAppPixSettings({
      enabled: true,
      defaultExpiresMinutes: 15,
    })
    expect(
      toWhatsAppPixSettingsDTO('ws1', settings, { id: 'psp', isTest: false }),
    ).toMatchObject({
      enabled: true,
      defaultExpiresMinutes: 15,
      provider: 'psp',
      isTestProvider: false,
    })
  })
})
