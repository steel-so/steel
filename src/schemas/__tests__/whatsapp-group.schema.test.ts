import { describe, expect, it } from 'vitest'
import {
  CreateWhatsAppGroupSchema,
  GroupParticipantsSchema,
  SendWhatsAppGroupTextMessageSchema,
  SetGroupAdminSchema,
  UpdateWhatsAppGroupSchema,
} from '../whatsapp-group.schema'

describe('CreateWhatsAppGroupSchema', () => {
  it('should accept a group with digit-only participant numbers', () => {
    expect(
      CreateWhatsAppGroupSchema.safeParse({
        connectionId: 'conn-1',
        name: 'Suporte',
        participantWaIds: ['5511999998888'],
      }).success,
    ).toBe(true)
  })

  it('should require at least one participant', () => {
    const result = CreateWhatsAppGroupSchema.safeParse({
      connectionId: 'conn-1',
      name: 'Suporte',
      participantWaIds: [],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(
      'Adicione ao menos um contato',
    )
  })

  it('should normalize formatted numbers and reject too short ones', () => {
    const formatted = CreateWhatsAppGroupSchema.safeParse({
      connectionId: 'conn-1',
      name: 'Suporte',
      participantWaIds: ['(11) 99999-8888'],
    })
    expect(formatted.success && formatted.data.participantWaIds).toEqual([
      '5511999998888',
    ])
    expect(
      CreateWhatsAppGroupSchema.safeParse({
        connectionId: 'conn-1',
        name: 'Suporte',
        participantWaIds: ['1234'],
      }).error?.issues[0]?.message,
    ).toBe('Número inválido')
  })

  it('should require a connection', () => {
    expect(
      CreateWhatsAppGroupSchema.safeParse({
        connectionId: '',
        name: 'Suporte',
        participantWaIds: ['5511999998888'],
      }).error?.issues[0]?.message,
    ).toBe('Conexão é obrigatória')
  })
})

describe('UpdateWhatsAppGroupSchema', () => {
  it('should accept partial updates', () => {
    expect(UpdateWhatsAppGroupSchema.safeParse({}).success).toBe(true)
    expect(
      UpdateWhatsAppGroupSchema.safeParse({ description: 'Grupo VIP' }).success,
    ).toBe(true)
  })

  it('should reject an invalid image URL and an empty name', () => {
    expect(
      UpdateWhatsAppGroupSchema.safeParse({ imageUrl: 'foto.png' }).success,
    ).toBe(false)
    expect(UpdateWhatsAppGroupSchema.safeParse({ name: '' }).success).toBe(
      false,
    )
  })
})

describe('participant and admin payloads', () => {
  it('should validate participant lists', () => {
    expect(GroupParticipantsSchema.safeParse({ waIds: [] }).success).toBe(false)
    expect(
      GroupParticipantsSchema.safeParse({ waIds: ['5511999998888'] }).success,
    ).toBe(true)
  })

  it('should require a boolean admin flag', () => {
    expect(
      SetGroupAdminSchema.safeParse({ waId: '5511999998888', admin: true })
        .success,
    ).toBe(true)
    expect(
      SetGroupAdminSchema.safeParse({ waId: '5511999998888', admin: 'yes' })
        .success,
    ).toBe(false)
  })
})

describe('SendWhatsAppGroupTextMessageSchema', () => {
  it('should accept text with optional mentions', () => {
    expect(
      SendWhatsAppGroupTextMessageSchema.safeParse({
        text: 'Oi @todos',
        mentionedWaIds: ['5511999998888'],
      }).success,
    ).toBe(true)
  })

  it('should reject empty or oversized text', () => {
    expect(
      SendWhatsAppGroupTextMessageSchema.safeParse({ text: '' }).error
        ?.issues[0]?.message,
    ).toBe('Mensagem não pode ser vazia')
    expect(
      SendWhatsAppGroupTextMessageSchema.safeParse({ text: 'x'.repeat(4097) })
        .success,
    ).toBe(false)
  })
})
