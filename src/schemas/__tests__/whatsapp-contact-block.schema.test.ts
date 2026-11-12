import { describe, expect, it } from 'vitest'
import {
  CreateWhatsAppContactBlockSchema,
  SyncWhatsAppContactBlocksSchema,
  WHATSAPP_CONTACT_BLOCK_REASON_MAX,
  WhatsAppContactBlockQuerySchema,
} from '../whatsapp-contact-block.schema'

describe('CreateWhatsAppContactBlockSchema', () => {
  it('accepts a conversation with a trimmed reason', () => {
    expect(
      CreateWhatsAppContactBlockSchema.parse({
        conversationId: 'cv1',
        reason: '  Ofensas  ',
      }),
    ).toEqual({ conversationId: 'cv1', reason: 'Ofensas' })
  })

  it('accepts a number + contact and turns an empty reason into null', () => {
    expect(
      CreateWhatsAppContactBlockSchema.parse({
        connectionId: 'conn1',
        contactId: 'ct1',
        reason: '   ',
      }),
    ).toEqual({ connectionId: 'conn1', contactId: 'ct1', reason: null })
    expect(
      CreateWhatsAppContactBlockSchema.parse({ conversationId: 'cv1' }).reason ??
        null,
    ).toBeNull()
    expect(
      CreateWhatsAppContactBlockSchema.parse({
        conversationId: 'cv1',
        reason: null,
      }).reason,
    ).toBeNull()
  })

  it('needs the conversation, or both the number and the contact', () => {
    for (const body of [{}, { connectionId: 'c' }, { contactId: 'ct' }]) {
      const parsed = CreateWhatsAppContactBlockSchema.safeParse(body)
      expect(parsed.success).toBe(false)
      expect(parsed.error?.issues[0].message).toBe(
        'Informe a conversa, ou o número e o contato',
      )
    }
  })

  it('caps the reason at 500 characters', () => {
    const parsed = CreateWhatsAppContactBlockSchema.safeParse({
      conversationId: 'cv1',
      reason: 'x'.repeat(WHATSAPP_CONTACT_BLOCK_REASON_MAX + 1),
    })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].message).toContain('até 500 caracteres')
    expect(
      CreateWhatsAppContactBlockSchema.safeParse({
        conversationId: 'cv1',
        reason: 'x'.repeat(WHATSAPP_CONTACT_BLOCK_REASON_MAX),
      }).success,
    ).toBe(true)
  })

  it('refuses empty ids', () => {
    expect(
      CreateWhatsAppContactBlockSchema.safeParse({ conversationId: '' })
        .success,
    ).toBe(false)
  })
})

describe('query and sync schemas', () => {
  it('take an optional number', () => {
    expect(WhatsAppContactBlockQuerySchema.parse({})).toEqual({})
    expect(
      WhatsAppContactBlockQuerySchema.parse({ connectionId: 'c1' }),
    ).toEqual({ connectionId: 'c1' })
    expect(SyncWhatsAppContactBlocksSchema.parse({})).toEqual({})
    expect(
      SyncWhatsAppContactBlocksSchema.safeParse({ connectionId: '' }).success,
    ).toBe(false)
  })
})
