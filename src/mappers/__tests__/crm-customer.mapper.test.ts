import { describe, expect, it } from 'vitest'
import {
  CRM_CUSTOMERS_CSV_HEADER,
  toCrmCustomerRowDTO,
  toCrmCustomersCsv,
} from '@/src/mappers/crm-customer.mapper'
import type { CustomerRow } from '@/src/repositories/crm-customer.repository'

function row(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    kind: 'COMPANY',
    entity_id: 'c1',
    name: 'Acme',
    subtitle: 'acme.com',
    deals: 3,
    total: 9000,
    average: 3000,
    first_won: new Date('2026-01-10T12:00:00Z'),
    last_won: new Date('2026-10-05T12:00:00Z'),
    next_renewal: new Date('2027-01-31T12:00:00Z'),
    owner_id: 'u1',
    owner_name: 'Maria',
    health_level: 'LOW',
    health_risk: 20,
    ...overrides,
  }
}

describe('toCrmCustomerRowDTO', () => {
  it('maps the aggregated row and turns risk into health', () => {
    const dto = toCrmCustomerRowDTO(row())
    expect(dto).toMatchObject({
      kind: 'COMPANY',
      id: 'c1',
      deals: 3,
      totalWon: 9000,
      averageTicket: 3000,
      firstWonAt: '2026-01-10T12:00:00.000Z',
      nextRenewalAt: '2027-01-31T12:00:00.000Z',
      ownerName: 'Maria',
      health: { level: 'LOW', score: 80 },
    })
  })

  it('leaves health and renewal empty for people without them', () => {
    const dto = toCrmCustomerRowDTO(
      row({
        kind: 'PERSON',
        health_level: null,
        health_risk: null,
        next_renewal: null,
        total: null,
        average: null,
      }),
    )
    expect(dto.health).toBeNull()
    expect(dto.nextRenewalAt).toBeNull()
    expect(dto.totalWon).toBe(0)
    expect(dto.averageTicket).toBe(0)
  })

  it('keeps the health score between 0 and 100', () => {
    expect(
      toCrmCustomerRowDTO(row({ health_level: 'HIGH', health_risk: 130 }))
        .health?.score,
    ).toBe(0)
  })
})

describe('toCrmCustomersCsv', () => {
  it('writes a BOM, the header and one line per customer', () => {
    const csv = toCrmCustomersCsv([toCrmCustomerRowDTO(row())])
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe(CRM_CUSTOMERS_CSV_HEADER.join(','))
    expect(lines[1]).toBe(
      'Acme,Empresa,acme.com,3,9000,3000,2026-01-10,2026-10-05,2027-01-31,Maria,Saudável (80)',
    )
  })

  it('quotes commas and neutralises spreadsheet formulas', () => {
    const csv = toCrmCustomersCsv([
      toCrmCustomerRowDTO(
        row({ name: '=HYPERLINK("x")', subtitle: 'Silva, Souza & Cia' }),
      ),
    ])
    const line = csv.slice(1).split('\r\n')[1]
    expect(
      line.startsWith(`"'=HYPERLINK(""x"")",Empresa,"Silva, Souza & Cia"`),
    ).toBe(true)
  })
})
