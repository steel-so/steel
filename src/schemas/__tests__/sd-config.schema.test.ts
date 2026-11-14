import { describe, expect, it } from 'vitest'
import {
  CreateSdCannedResponseSchema,
  ListSdCannedResponsesSchema,
  UpdateSdCannedResponseSchema,
} from '../sd-canned-response.schema'
import {
  booleanQuery,
  ListSdAgentsSchema,
  ReorderSdConfigSchema,
  sdColor,
  sdName,
} from '../sd-config.schema'
import {
  AddSdDepartmentMemberSchema,
  CreateSdDepartmentSchema,
  ListSdDepartmentsSchema,
  UpdateSdDepartmentMemberSchema,
  UpdateSdDepartmentSchema,
} from '../sd-department.schema'
import {
  CreateSdPartSchema,
  ListSdPartsSchema,
  SdMoneySchema,
  UpdateSdPartSchema,
} from '../sd-part.schema'
import {
  SD_DEFAULT_TICKET_PREFIXES,
  UpdateSdSettingsSchema,
} from '../sd-settings.schema'

describe('sd-config shared schemas', () => {
  it('trims names and rejects empty/too long', () => {
    expect(sdName.parse('  Infra ')).toBe('Infra')
    expect(sdName.safeParse('   ').success).toBe(false)
    expect(sdName.safeParse('x'.repeat(121)).success).toBe(false)
  })

  it('accepts #RRGGBB colors or null', () => {
    expect(sdColor.parse('#aaBB00')).toBe('#aaBB00')
    expect(sdColor.parse(null)).toBeNull()
    expect(sdColor.safeParse('red').success).toBe(false)
  })

  it('parses boolean query strings', () => {
    expect(booleanQuery.parse('true')).toBe(true)
    expect(booleanQuery.parse('false')).toBe(false)
    expect(booleanQuery.parse(undefined)).toBe(false)
    expect(booleanQuery.safeParse('yes').success).toBe(false)
    expect(ListSdAgentsSchema.parse({ includeRequesters: 'true' })).toEqual({
      includeRequesters: true,
    })
  })

  it('requires a non-empty reorder list', () => {
    expect(ReorderSdConfigSchema.safeParse({ orderedIds: [] }).success).toBe(
      false,
    )
    expect(ReorderSdConfigSchema.parse({ orderedIds: ['a'] })).toEqual({
      orderedIds: ['a'],
    })
  })
})

describe('UpdateSdSettingsSchema', () => {
  it('validates the requester WhatsApp templates', () => {
    const valid = {
      'ticket.resolved': {
        templateName: 'chamado_resolvido',
        language: 'pt_BR',
        variables: ['code', 'headline'],
      },
    }
    expect(
      UpdateSdSettingsSchema.safeParse({ requesterWhatsappTemplates: valid })
        .success,
    ).toBe(true)
    expect(
      UpdateSdSettingsSchema.safeParse({
        requesterWhatsappTemplates: {
          'ticket.assigned': valid['ticket.resolved'],
        },
      }).success,
    ).toBe(false)
    expect(
      UpdateSdSettingsSchema.safeParse({
        requesterWhatsappTemplates: {
          'ticket.resolved': {
            ...valid['ticket.resolved'],
            templateName: 'Nome Inválido',
          },
        },
      }).success,
    ).toBe(false)
    expect(
      UpdateSdSettingsSchema.safeParse({
        requesterWhatsappTemplates: {
          'ticket.resolved': { ...valid['ticket.resolved'], variables: ['x'] },
        },
      }).success,
    ).toBe(false)
  })

  it('exposes the default prefixes', () => {
    expect(SD_DEFAULT_TICKET_PREFIXES.INCIDENT).toBe('INC')
  })

  it('uppercases prefixes and dedupes lists', () => {
    const parsed = UpdateSdSettingsSchema.parse({
      ticketPrefixes: { INCIDENT: ' inc2 ' },
      portalTicketTypes: ['INCIDENT', 'INCIDENT'],
      aiHandoffKeywords: ['humano', 'humano', 'atendente'],
    })
    expect(parsed.ticketPrefixes).toEqual({ INCIDENT: 'INC2' })
    expect(parsed.portalTicketTypes).toEqual(['INCIDENT'])
    expect(parsed.aiHandoffKeywords).toEqual(['humano', 'atendente'])
  })

  it('rejects an empty body and invalid values', () => {
    expect(UpdateSdSettingsSchema.safeParse({}).success).toBe(false)
    expect(
      UpdateSdSettingsSchema.safeParse({ ticketPrefixes: { CHANGE: 'A-B' } })
        .success,
    ).toBe(false)
    expect(
      UpdateSdSettingsSchema.safeParse({ slaAtRiskPercent: 100 }).success,
    ).toBe(false)
    expect(
      UpdateSdSettingsSchema.safeParse({ autoCloseResolvedAfterHours: -1 })
        .success,
    ).toBe(false)
  })
})

describe('department schemas', () => {
  it('applies defaults on create', () => {
    expect(CreateSdDepartmentSchema.parse({ name: 'N1' })).toEqual({
      name: 'N1',
      active: true,
    })
    expect(
      CreateSdDepartmentSchema.safeParse({ name: 'N1', email: 'x' }).success,
    ).toBe(false)
  })

  it('requires at least one field on update', () => {
    expect(UpdateSdDepartmentSchema.safeParse({}).success).toBe(false)
    expect(UpdateSdDepartmentSchema.parse({ parentId: null })).toEqual({
      parentId: null,
    })
  })

  it('parses list and member schemas', () => {
    expect(ListSdDepartmentsSchema.parse({})).toEqual({
      includeInactive: false,
    })
    expect(AddSdDepartmentMemberSchema.parse({ userId: 'u1' })).toEqual({
      userId: 'u1',
      isLead: false,
    })
    expect(UpdateSdDepartmentMemberSchema.safeParse({}).success).toBe(false)
  })
})

describe('canned response schemas', () => {
  it('validates shortcut and body', () => {
    expect(
      CreateSdCannedResponseSchema.parse({
        title: 'Oi',
        body: 'Olá!',
        shortcut: 'ola',
      }),
    ).toEqual({ title: 'Oi', body: 'Olá!', shortcut: 'ola' })
    expect(
      CreateSdCannedResponseSchema.safeParse({
        title: 'Oi',
        body: 'x',
        shortcut: 'com espaço',
      }).success,
    ).toBe(false)
    expect(
      CreateSdCannedResponseSchema.safeParse({ title: 'Oi', body: ' ' })
        .success,
    ).toBe(false)
  })

  it('requires a field on update and parses list filters', () => {
    expect(UpdateSdCannedResponseSchema.safeParse({}).success).toBe(false)
    expect(UpdateSdCannedResponseSchema.parse({ shortcut: null })).toEqual({
      shortcut: null,
    })
    expect(ListSdCannedResponsesSchema.parse({ q: ' senha ' })).toEqual({
      q: 'senha',
    })
  })
})

describe('part schemas', () => {
  it('normalizes money', () => {
    expect(SdMoneySchema.parse(10)).toBe('10.00')
    expect(SdMoneySchema.parse('129,9')).toBe('129.90')
    expect(SdMoneySchema.parse(' 1.005 ')).toBe('1.00')
  })

  it.each([-1, 'abc', Number.NaN, 1_000_000_000_000])('rejects %s', (value) => {
    expect(SdMoneySchema.safeParse(value).success).toBe(false)
  })

  it('applies defaults and requires update fields', () => {
    expect(CreateSdPartSchema.parse({ name: 'Cabo' })).toEqual({
      name: 'Cabo',
      unitCost: '0.00',
      active: true,
    })
    expect(
      CreateSdPartSchema.safeParse({ name: 'Cabo', stock: -1 }).success,
    ).toBe(false)
    expect(UpdateSdPartSchema.safeParse({}).success).toBe(false)
    expect(UpdateSdPartSchema.parse({ unitCost: 2 })).toEqual({
      unitCost: '2.00',
    })
    expect(ListSdPartsSchema.parse({})).toEqual({ includeInactive: false })
  })
})
