import { describe, expect, it } from 'vitest'
import {
  normalizePhone,
  parseBroadcastImportCsv,
  parseReferenceDate,
  validateBroadcastImportRows,
} from '../whatsapp/broadcast-import'

describe('parseBroadcastImportCsv()', () => {
  it('should parse a well-formed CSV with variables', () => {
    const csv = [
      'telefone,nome,data_referencia,var_1,var_2',
      '11987654321,Maria,2026-08-15T09:00:00,Maria,15/08 às 09h',
      '5511912345678,João,2026-08-16T14:00:00,João,16/08 às 14h',
    ].join('\n')

    const { rows, parseErrors } = parseBroadcastImportCsv(csv)

    expect(parseErrors).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      phone: '11987654321',
      contactName: 'Maria',
      referenceDate: '2026-08-15T09:00:00',
      variables: ['Maria', '15/08 às 09h'],
    })
  })

  it('should handle quoted fields containing commas', () => {
    const csv = [
      'telefone,data_referencia,var_1',
      '"11987654321","2026-08-15","Rua A, 123"',
    ].join('\n')

    const { rows } = parseBroadcastImportCsv(csv)

    expect(rows[0].variables).toEqual(['Rua A, 123'])
  })

  it('should error when required headers are missing', () => {
    const csv = 'nome,var_1\nMaria,x'

    const { rows, parseErrors } = parseBroadcastImportCsv(csv)

    expect(rows).toEqual([])
    expect(parseErrors[0]).toMatch(/telefone/)
  })

  it('should error on an empty file', () => {
    const { parseErrors } = parseBroadcastImportCsv('')
    expect(parseErrors).toHaveLength(1)
  })

  it('should order var_N columns numerically regardless of header order', () => {
    const csv = [
      'telefone,data_referencia,var_2,var_1',
      '11987654321,2026-08-15,segundo,primeiro',
    ].join('\n')

    const { rows } = parseBroadcastImportCsv(csv)

    expect(rows[0].variables).toEqual(['primeiro', 'segundo'])
  })
})

describe('normalizePhone()', () => {
  it('should strip non-digit characters', () => {
    expect(normalizePhone('+55 (11) 98765-4321')).toBe('5511987654321')
  })
})

describe('validateBroadcastImportRows()', () => {
  const baseRow = {
    phone: '11987654321',
    contactName: 'Maria',
    referenceDate: '2026-08-15T09:00:00.000Z',
    variables: ['Maria', 'amanhã'],
  }

  it('should accept a valid row and compute scheduledAt from the offset', () => {
    const { valid, rejected } = validateBroadcastImportRows([baseRow], 2, 24)

    expect(rejected).toEqual([])
    expect(valid).toHaveLength(1)
    expect(valid[0].phone).toBe('11987654321')
    expect(valid[0].variableValues).toEqual({
      body: { '1': 'Maria', '2': 'amanhã' },
    })
    expect(valid[0].scheduledAt.toISOString()).toBe('2026-08-14T09:00:00.000Z')
    expect(valid[0].appointmentAt.toISOString()).toBe(
      '2026-08-15T09:00:00.000Z',
    )
  })

  it('should reject an invalid phone number', () => {
    const { valid, rejected } = validateBroadcastImportRows(
      [{ ...baseRow, phone: 'abc' }],
      2,
      24,
    )

    expect(valid).toEqual([])
    expect(rejected[0].reason).toMatch(/Telefone inválido/)
  })

  it('should reject an invalid reference date', () => {
    const { rejected } = validateBroadcastImportRows(
      [{ ...baseRow, referenceDate: 'not-a-date' }],
      2,
      24,
    )

    expect(rejected[0].reason).toMatch(/Data de referência inválida/)
  })

  it('should reject a row with the wrong number of variables', () => {
    const { rejected } = validateBroadcastImportRows(
      [{ ...baseRow, variables: ['only-one'] }],
      2,
      24,
    )

    expect(rejected[0].reason).toMatch(/exige 2 variável/)
  })

  it('should reject a row with a blank variable', () => {
    const { rejected } = validateBroadcastImportRows(
      [{ ...baseRow, variables: ['Maria', ''] }],
      2,
      24,
    )

    expect(rejected[0].reason).toMatch(/em branco/)
  })

  it('should process multiple rows independently (partial success)', () => {
    const { valid, rejected } = validateBroadcastImportRows(
      [baseRow, { ...baseRow, phone: 'invalid' }],
      2,
      24,
    )

    expect(valid).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].rowNumber).toBe(2)
  })
})

describe('parseReferenceDate()', () => {
  it('reads dd/MM/yyyy HH:mm as São Paulo wall time', () => {
    expect(parseReferenceDate('15/12/2026 09:30')?.toISOString()).toBe(
      '2026-12-15T12:30:00.000Z',
    )
  })

  it('reads a date without time as midnight in the given zone', () => {
    expect(
      parseReferenceDate('15/12/2026', 'America/Manaus')?.toISOString(),
    ).toBe('2026-12-15T04:00:00.000Z')
  })

  it('reads an ISO date without an offset as wall time in the zone, not UTC', () => {
    expect(parseReferenceDate('2026-11-21T10:00')?.toISOString()).toBe(
      '2026-11-21T13:00:00.000Z',
    )
    expect(parseReferenceDate('2026-11-21 10:00:30')?.toISOString()).toBe(
      '2026-11-21T13:00:00.000Z',
    )
    expect(
      parseReferenceDate('2026-11-21', 'America/Manaus')?.toISOString(),
    ).toBe('2026-11-21T04:00:00.000Z')
    expect(parseReferenceDate('2026-02-31T10:00')).toBeNull()
  })

  it('keeps accepting ISO 8601', () => {
    expect(parseReferenceDate('2026-08-15T09:00:00.000Z')?.toISOString()).toBe(
      '2026-08-15T09:00:00.000Z',
    )
  })

  it('rejects impossible calendar dates and garbage', () => {
    expect(parseReferenceDate('31/02/2026 10:00')).toBeNull()
    expect(parseReferenceDate('15/12/2026 25:00')).toBeNull()
    expect(parseReferenceDate('amanhã')).toBeNull()
  })
})

describe('validateBroadcastImportRows() with a clock', () => {
  const row = {
    phone: '11987654321',
    referenceDate: '15/12/2026 09:30',
    variables: ['Maria'],
  }

  it('accepts a row whose send time is still ahead', () => {
    const { valid, rejected } = validateBroadcastImportRows([row], 1, 24, {
      now: new Date('2026-12-01T00:00:00.000Z'),
    })
    expect(rejected).toEqual([])
    expect(valid[0].scheduledAt.toISOString()).toBe('2026-12-14T12:30:00.000Z')
  })

  it('rejects a row whose send time already passed, naming the date', () => {
    const { valid, rejected } = validateBroadcastImportRows([row], 1, 24, {
      now: new Date('2026-12-20T00:00:00.000Z'),
    })
    expect(valid).toEqual([])
    expect(rejected[0].reason).toMatch(/já passou/)
    expect(rejected[0].reason).toMatch(/14\/12\/2026/)
  })
})
