import { describe, expect, it } from 'vitest'
import {
  CreateWhatsAppContactFieldSchema,
  UpdateWhatsAppContactFieldSchema,
} from '../whatsapp-contact-field.schema'

describe('CreateWhatsAppContactFieldSchema', () => {
  it('defaults to an optional TEXT field', () => {
    const parsed = CreateWhatsAppContactFieldSchema.parse({ label: 'CPF' })
    expect(parsed).toMatchObject({
      label: 'CPF',
      type: 'TEXT',
      options: [],
      required: false,
    })
  })

  it('accepts the validated types', () => {
    for (const type of ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'URL', 'CEP']) {
      expect(
        CreateWhatsAppContactFieldSchema.safeParse({ label: 'X', type })
          .success,
      ).toBe(true)
    }
  })

  it('requires options for a SELECT and rejects duplicates', () => {
    expect(
      CreateWhatsAppContactFieldSchema.safeParse({ label: 'X', type: 'SELECT' })
        .success,
    ).toBe(false)
    expect(
      CreateWhatsAppContactFieldSchema.safeParse({
        label: 'X',
        type: 'SELECT',
        options: ['A', 'A'],
      }).success,
    ).toBe(false)
  })

  it('rejects a blank label', () => {
    expect(
      CreateWhatsAppContactFieldSchema.safeParse({ label: '   ' }).success,
    ).toBe(false)
  })
})

describe('UpdateWhatsAppContactFieldSchema', () => {
  it('does not accept a type change', () => {
    const parsed = UpdateWhatsAppContactFieldSchema.parse({
      label: 'Novo',
      type: 'CNPJ',
    })
    expect(parsed).toEqual({ label: 'Novo' })
  })
})
