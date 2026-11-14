import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import {
  toWhatsAppConnectionCreatedDTO,
  toWhatsAppConnectionDTO,
} from '../whatsapp-connection.mapper'

describe('toWhatsAppConnectionDTO()', () => {
  it('should map fields and never leak secrets', () => {
    const connection = createFakeWhatsAppConnection({
      id: 'c1',
      provider: 'ZAPI',
      label: 'Suporte',
      encryptedZapiToken: 'enc:super-secret',
      webhookSecret: 'super-secret-webhook',
    })

    const dto = toWhatsAppConnectionDTO(connection)

    expect(dto.id).toBe('c1')
    expect(dto.provider).toBe('ZAPI')
    expect(dto.label).toBe('Suporte')
    expect(dto).not.toHaveProperty('encryptedZapiToken')
    expect(dto).not.toHaveProperty('encryptedZapiClientToken')
    expect(dto).not.toHaveProperty('encryptedMetaAccessToken')
    expect(dto).not.toHaveProperty('webhookSecret')
  })

  it('should serialize timestamps as ISO strings', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z')
    const connection = createFakeWhatsAppConnection({ createdAt })

    const dto = toWhatsAppConnectionDTO(connection)

    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('toWhatsAppConnectionCreatedDTO()', () => {
  it('should include the webhook secret exactly once, on creation', () => {
    const connection = createFakeWhatsAppConnection({
      webhookSecret: 'reveal-me-once',
    })

    const dto = toWhatsAppConnectionCreatedDTO(connection)

    expect(dto.webhookSecret).toBe('reveal-me-once')
  })
})

describe('webhookUrl', () => {
  it('should only be included for Z-API when a base URL is given', () => {
    const zapi = createFakeWhatsAppConnection({
      provider: 'ZAPI',
      webhookSecret: 's3 cret',
    })
    const meta = createFakeWhatsAppConnection({ provider: 'META' })

    expect(toWhatsAppConnectionDTO(zapi).webhookUrl).toBeUndefined()
    expect(toWhatsAppConnectionDTO(meta, 'https://x.io').webhookUrl).toBe(
      undefined,
    )
    expect(toWhatsAppConnectionDTO(zapi, 'https://x.io/').webhookUrl).toBe(
      'https://x.io/api/whatsapp/webhook/zapi?secret=s3%20cret',
    )
  })
})
