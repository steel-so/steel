import { describe, expect, it } from 'vitest'
import {
  CreateSdTicketFromSourceSchema,
  SD_TICKET_SOURCE_KINDS,
  SdTicketSourceQuerySchema,
} from '../sd-ticket-source.schema'

describe('SdTicketSourceQuerySchema', () => {
  it('accepts every source kind', () => {
    for (const source of SD_TICKET_SOURCE_KINDS) {
      expect(
        SdTicketSourceQuerySchema.safeParse({ source, sourceId: 'abc' })
          .success,
      ).toBe(true)
    }
  })

  it('rejects unknown kinds, missing and oversized ids', () => {
    expect(
      SdTicketSourceQuerySchema.safeParse({ source: 'x', sourceId: 'a' })
        .success,
    ).toBe(false)
    expect(
      SdTicketSourceQuerySchema.safeParse({ source: 'lead', sourceId: '' })
        .success,
    ).toBe(false)
    expect(
      SdTicketSourceQuerySchema.safeParse({ source: 'lead', sourceId: null })
        .success,
    ).toBe(false)
    expect(
      SdTicketSourceQuerySchema.safeParse({
        source: 'lead',
        sourceId: 'a'.repeat(65),
      }).success,
    ).toBe(false)
  })
})

describe('CreateSdTicketFromSourceSchema', () => {
  it('fills the defaults', () => {
    const parsed = CreateSdTicketFromSourceSchema.parse({
      source: 'conversation',
      sourceId: 'c1',
    })
    expect(parsed).toMatchObject({
      type: 'SERVICE_REQUEST',
      includeMessages: true,
      messageCount: 10,
      allowDuplicate: false,
    })
    expect(parsed.title).toBeUndefined()
  })

  it('trims the title and bounds the message count', () => {
    expect(
      CreateSdTicketFromSourceSchema.parse({
        source: 'lead',
        sourceId: 'l1',
        title: '  Ajuda  ',
      }).title,
    ).toBe('Ajuda')
    for (const messageCount of [0, 31, 1.5]) {
      expect(
        CreateSdTicketFromSourceSchema.safeParse({
          source: 'lead',
          sourceId: 'l1',
          messageCount,
        }).success,
      ).toBe(false)
    }
  })

  it('rejects an empty or too long title and an invalid type', () => {
    for (const title of ['   ', 'a'.repeat(201)]) {
      expect(
        CreateSdTicketFromSourceSchema.safeParse({
          source: 'lead',
          sourceId: 'l1',
          title,
        }).success,
      ).toBe(false)
    }
    expect(
      CreateSdTicketFromSourceSchema.safeParse({
        source: 'lead',
        sourceId: 'l1',
        type: 'NOPE',
      }).success,
    ).toBe(false)
  })
})
