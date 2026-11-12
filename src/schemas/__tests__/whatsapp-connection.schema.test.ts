import { describe, expect, it } from 'vitest'
import {
  CreateWhatsAppConnectionSchema,
  UpdateWhatsAppConnectionSchema,
  WhatsAppProviderSchema,
} from '../whatsapp-connection.schema'

const zapiInput = {
  provider: 'ZAPI' as const,
  label: 'Suporte',
  phoneNumber: '5511999999999',
  zapiInstanceId: 'instance-1',
  zapiToken: 'token-1',
}

const metaInput = {
  provider: 'META' as const,
  label: 'Vendas',
  phoneNumber: '5511988888888',
  metaPhoneNumberId: 'phone-id-1',
  metaWabaId: 'waba-1',
  metaAccessToken: 'access-token-1',
}

describe('WhatsAppProviderSchema', () => {
  it('should accept ZAPI and META', () => {
    expect(WhatsAppProviderSchema.safeParse('ZAPI').success).toBe(true)
    expect(WhatsAppProviderSchema.safeParse('META').success).toBe(true)
  })

  it('should reject unknown providers', () => {
    expect(WhatsAppProviderSchema.safeParse('TWILIO').success).toBe(false)
  })
})

describe('CreateWhatsAppConnectionSchema', () => {
  it('should accept a valid ZAPI payload', () => {
    expect(CreateWhatsAppConnectionSchema.safeParse(zapiInput).success).toBe(
      true,
    )
  })

  it('should accept a valid META payload', () => {
    expect(CreateWhatsAppConnectionSchema.safeParse(metaInput).success).toBe(
      true,
    )
  })

  it('should reject a ZAPI payload missing zapiToken', () => {
    const { zapiToken: _zapiToken, ...withoutToken } = zapiInput
    expect(CreateWhatsAppConnectionSchema.safeParse(withoutToken).success).toBe(
      false,
    )
  })

  it('should reject a META payload missing metaWabaId', () => {
    const { metaWabaId: _metaWabaId, ...withoutWaba } = metaInput
    expect(CreateWhatsAppConnectionSchema.safeParse(withoutWaba).success).toBe(
      false,
    )
  })

  it('should reject a META payload carrying ZAPI-only fields as the discriminant', () => {
    expect(
      CreateWhatsAppConnectionSchema.safeParse({
        ...zapiInput,
        provider: 'META',
      }).success,
    ).toBe(false)
  })

  it('should accept a masked phone number and store it with 55', () => {
    const parsed = CreateWhatsAppConnectionSchema.safeParse({
      ...zapiInput,
      phoneNumber: '(11) 99999-9999',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.phoneNumber).toBe('5511999999999')
  })

  it('should reject a phone number with letters', () => {
    expect(
      CreateWhatsAppConnectionSchema.safeParse({
        ...zapiInput,
        phoneNumber: '1199999abc',
      }).success,
    ).toBe(false)
  })

  it('should reject an empty label', () => {
    expect(
      CreateWhatsAppConnectionSchema.safeParse({ ...zapiInput, label: '' })
        .success,
    ).toBe(false)
  })
})

describe('UpdateWhatsAppConnectionSchema', () => {
  it('should accept an empty object (all fields optional)', () => {
    expect(UpdateWhatsAppConnectionSchema.safeParse({}).success).toBe(true)
  })

  it('should accept a partial update of just the label', () => {
    const result = UpdateWhatsAppConnectionSchema.safeParse({
      label: 'Novo nome',
    })
    expect(result.success).toBe(true)
    expect(result.data?.label).toBe('Novo nome')
  })
})
