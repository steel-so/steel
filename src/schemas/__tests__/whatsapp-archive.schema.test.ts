import { describe, expect, it } from 'vitest'
import {
  TriggerWhatsAppArchiveSchema,
  UpdateWhatsAppArchiveSettingsSchema,
  WhatsAppArchiveRootFolderSchema,
} from '@/src/schemas/whatsapp-archive.schema'

describe('WhatsAppArchiveRootFolderSchema', () => {
  it.each(['FIDELIZZAMAIS', 'banco_x-2026', 'A'])('accepts %s', (value) => {
    expect(WhatsAppArchiveRootFolderSchema.parse(value)).toBe(value)
  })

  it('trims spaces', () => {
    expect(WhatsAppArchiveRootFolderSchema.parse('  BANCO ')).toBe('BANCO')
  })

  it.each([
    ['', 'Informe'],
    ['A'.repeat(41), 'no máximo 40'],
    ['ação', 'letras sem acento'],
    ['a/b', 'letras sem acento'],
    ['-x', 'letras sem acento'],
    ['con', 'reservado'],
    ['LPT1', 'reservado'],
  ])('rejects %s', (value, message) => {
    const result = WhatsAppArchiveRootFolderSchema.safeParse(value)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toContain(message)
  })
})

describe('UpdateWhatsAppArchiveSettingsSchema', () => {
  it('accepts enabled, a root folder or null', () => {
    expect(
      UpdateWhatsAppArchiveSettingsSchema.parse({ enabled: true }),
    ).toEqual({
      enabled: true,
    })
    expect(
      UpdateWhatsAppArchiveSettingsSchema.parse({ rootFolderName: null }),
    ).toEqual({ rootFolderName: null })
  })

  it('rejects an empty update and wrong types', () => {
    expect(UpdateWhatsAppArchiveSettingsSchema.safeParse({}).success).toBe(
      false,
    )
    expect(
      UpdateWhatsAppArchiveSettingsSchema.safeParse({ enabled: 'yes' }).success,
    ).toBe(false)
  })
})

describe('TriggerWhatsAppArchiveSchema', () => {
  it('accepts the two kinds only', () => {
    expect(TriggerWhatsAppArchiveSchema.parse({ kind: 'WEEKLY' })).toEqual({
      kind: 'WEEKLY',
    })
    expect(
      TriggerWhatsAppArchiveSchema.safeParse({ kind: 'MONTHLY_FULL' }).success,
    ).toBe(true)
    expect(
      TriggerWhatsAppArchiveSchema.safeParse({ kind: 'DAILY' }).success,
    ).toBe(false)
  })
})
