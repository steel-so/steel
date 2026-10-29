import { describe, expect, it } from 'vitest'
import {
  createFakeFlow,
  createFakeFlowResponse,
  createFakePublishedFlow,
} from '@/src/__tests__/factories/nov-z3-whatsapp-flows.factory'
import {
  parseStoredDefinition,
  toWhatsAppFlowDTO,
  toWhatsAppFlowListItemDTO,
  toWhatsAppFlowResponseDTO,
} from '../whatsapp-flow.mapper'

describe('parseStoredDefinition', () => {
  it('reads a valid definition', () => {
    const flow = createFakeFlow()
    expect(
      parseStoredDefinition(flow.definition).screens.length,
    ).toBeGreaterThan(0)
  })

  it('reads anything malformed as an empty flow', () => {
    expect(parseStoredDefinition(null)).toEqual({ screens: [] })
    expect(parseStoredDefinition({ screens: 'x' })).toEqual({ screens: [] })
  })
})

describe('toWhatsAppFlowDTO', () => {
  it('maps a draft that was never sent', () => {
    const dto = toWhatsAppFlowDTO(createFakeFlow({ name: 'Cadastro' }))
    expect(dto).toMatchObject({
      name: 'Cadastro',
      status: 'DRAFT',
      category: 'SIGN_UP',
      hasUnpublishedChanges: true,
      sendable: false,
      publishedAt: null,
      metaFlowId: null,
    })
    expect(typeof dto.createdAt).toBe('string')
  })

  it('marks a published flow with no edits as up to date and sendable', () => {
    const dto = toWhatsAppFlowDTO(createFakePublishedFlow())
    expect(dto.hasUnpublishedChanges).toBe(false)
    expect(dto.sendable).toBe(true)
    expect(dto.publishedAt).not.toBeNull()
  })

  it('flags edits made after the last send to Meta', () => {
    const flow = createFakePublishedFlow()
    const definition = parseStoredDefinition(flow.definition)
    definition.screens[0].title = 'Novo título'
    const dto = toWhatsAppFlowDTO({
      ...flow,
      definition: definition as unknown as typeof flow.definition,
    })
    expect(dto.hasUnpublishedChanges).toBe(true)
  })

  it('does not let a deprecated flow be sent', () => {
    const dto = toWhatsAppFlowDTO(
      createFakePublishedFlow({ status: 'DEPRECATED' }),
    )
    expect(dto.sendable).toBe(false)
  })

  it('falls back to OTHER for an unknown stored category', () => {
    expect(
      toWhatsAppFlowDTO(createFakeFlow({ category: 'ZZZ' })).category,
    ).toBe('OTHER')
  })
})

describe('toWhatsAppFlowListItemDTO', () => {
  it('adds the sent and completed counters', () => {
    const dto = toWhatsAppFlowListItemDTO(createFakeFlow(), {
      sent: 5,
      completed: 2,
    })
    expect(dto).toMatchObject({ sent: 5, completed: 2 })
  })
})

describe('toWhatsAppFlowResponseDTO', () => {
  const contact = { name: 'Maria', waId: '5511988887777' }

  it('maps a pending send', () => {
    const dto = toWhatsAppFlowResponseDTO({
      ...createFakeFlowResponse(),
      contact,
    })
    expect(dto).toMatchObject({
      status: 'SENT',
      answers: null,
      contactName: 'Maria',
      contactWaId: '5511988887777',
      respondedAt: null,
    })
  })

  it('maps an answered send with its answers and CRM record', () => {
    const respondedAt = new Date('2026-10-29T12:00:00Z')
    const dto = toWhatsAppFlowResponseDTO({
      ...createFakeFlowResponse({
        status: 'COMPLETED',
        answers: { nome: 'Ana' },
        createdLeadId: 'lead1',
        respondedAt,
      }),
      contact,
    })
    expect(dto.answers).toEqual({ nome: 'Ana' })
    expect(dto.createdLeadId).toBe('lead1')
    expect(dto.respondedAt).toBe('2026-10-29T12:00:00.000Z')
  })

  it('reads non-object answers as empty', () => {
    const dto = toWhatsAppFlowResponseDTO({
      ...createFakeFlowResponse({ answers: ['x'] }),
      contact,
    })
    expect(dto.answers).toBeNull()
  })
})
