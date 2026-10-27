import { describe, expect, it } from 'vitest'
import {
  CreateWhatsAppContactSchema,
  ListWhatsAppContactsSchema,
  UpdateWhatsAppContactBroadcastOptOutSchema,
  UpdateWhatsAppContactSchema,
} from '../whatsapp-contact.schema'

describe('CreateWhatsAppContactSchema', () => {
  it('should accept a valid contact with name', () => {
    const result = CreateWhatsAppContactSchema.safeParse({
      waId: '5511988887777',
      name: 'Maria Silva',
    })
    expect(result.success).toBe(true)
  })

  it('should accept a contact without a name', () => {
    expect(
      CreateWhatsAppContactSchema.safeParse({ waId: '5511988887777' }).success,
    ).toBe(true)
  })

  it('should reject a waId with letters', () => {
    expect(
      CreateWhatsAppContactSchema.safeParse({ waId: '55119888-7777' }).success,
    ).toBe(false)
  })

  it('should reject a waId shorter than 8 digits', () => {
    expect(
      CreateWhatsAppContactSchema.safeParse({ waId: '1234567' }).success,
    ).toBe(false)
  })

  it('should reject an invalid avatarUrl', () => {
    expect(
      CreateWhatsAppContactSchema.safeParse({
        waId: '5511988887777',
        avatarUrl: 'not-a-url',
      }).success,
    ).toBe(false)
  })
})

describe('UpdateWhatsAppContactSchema', () => {
  it('should accept an empty object', () => {
    expect(UpdateWhatsAppContactSchema.safeParse({}).success).toBe(true)
  })

  it('should accept null to clear name, photo and description', () => {
    const result = UpdateWhatsAppContactSchema.safeParse({
      name: null,
      avatarUrl: null,
      description: null,
    })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      name: null,
      avatarUrl: null,
      description: null,
    })
  })

  it('should normalize emptied fields to null', () => {
    const result = UpdateWhatsAppContactSchema.safeParse({
      name: '',
      avatarUrl: '',
      description: ' ',
    })
    expect(result.data).toEqual({
      name: null,
      avatarUrl: null,
      description: null,
    })
  })

  it('should still reject an invalid avatarUrl', () => {
    expect(
      UpdateWhatsAppContactSchema.safeParse({ avatarUrl: 'not-a-url' }).success,
    ).toBe(false)
  })
})

describe('ListWhatsAppContactsSchema', () => {
  it('should accept an optional search term', () => {
    expect(ListWhatsAppContactsSchema.safeParse({}).success).toBe(true)
    expect(
      ListWhatsAppContactsSchema.safeParse({ search: 'maria' }).success,
    ).toBe(true)
  })

  it('should accept the "inserted today" filter and reject other values', () => {
    expect(
      ListWhatsAppContactsSchema.safeParse({ created: 'today' }).success,
    ).toBe(true)
    expect(
      ListWhatsAppContactsSchema.safeParse({ created: 'yesterday' }).success,
    ).toBe(false)
  })
})

describe('UpdateWhatsAppContactBroadcastOptOutSchema', () => {
  it('should accept an admin opt-out', () => {
    expect(
      UpdateWhatsAppContactBroadcastOptOutSchema.safeParse({ optedOut: true })
        .success,
    ).toBe(true)
  })

  it('should reject a re-subscribe without an explicit contact request', () => {
    expect(
      UpdateWhatsAppContactBroadcastOptOutSchema.safeParse({ optedOut: false })
        .success,
    ).toBe(false)
    expect(
      UpdateWhatsAppContactBroadcastOptOutSchema.safeParse({
        optedOut: false,
        contactRequested: false,
      }).success,
    ).toBe(false)
  })

  it('should accept a re-subscribe confirmed as requested by the contact', () => {
    expect(
      UpdateWhatsAppContactBroadcastOptOutSchema.safeParse({
        optedOut: false,
        contactRequested: true,
      }).success,
    ).toBe(true)
  })
})
