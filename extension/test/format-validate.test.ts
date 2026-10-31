import { describe, expect, it } from 'vitest'
import { formatDate, labelOf, LEAD_STAGE_LABEL } from '../src/lib/format'
import { normalizeBaseUrl, TOKEN_PATTERN } from '../src/lib/validate'

describe('formatDate', () => {
  it('formats in the product time zone, not the runtime one', () => {
    expect(formatDate('2026-11-02T01:30:00.000Z')).toBe('01/11/2026')
    expect(formatDate('2026-11-02T12:00:00.000Z')).toBe('02/11/2026')
  })

  it('is empty for missing or invalid dates', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate('nope')).toBe('')
  })
})

describe('labelOf', () => {
  it('falls back to the key', () => {
    expect(labelOf(LEAD_STAGE_LABEL, 'QUALIFIED')).toBe('Qualificado')
    expect(labelOf(LEAD_STAGE_LABEL, 'NEW_STAGE')).toBe('NEW_STAGE')
  })
})

describe('normalizeBaseUrl', () => {
  it('keeps only the origin and assumes https', () => {
    expect(normalizeBaseUrl('steel.example.com/app/')).toBe('https://steel.example.com')
    expect(normalizeBaseUrl(' https://steel.example.com/ ')).toBe('https://steel.example.com')
  })

  it('allows plain http only for localhost', () => {
    expect(normalizeBaseUrl('http://localhost:3001')).toBe('http://localhost:3001')
    expect(normalizeBaseUrl('http://127.0.0.1:3001')).toBe('http://127.0.0.1:3001')
    expect(normalizeBaseUrl('http://steel.example.com')).toBeNull()
  })

  it('rejects empty and malformed values', () => {
    expect(normalizeBaseUrl('')).toBeNull()
    expect(normalizeBaseUrl('http://')).toBeNull()
    expect(normalizeBaseUrl('ftp://x.com')).toBeNull()
  })
})

describe('TOKEN_PATTERN', () => {
  it('accepts the stl_pat_ wire format only', () => {
    expect(TOKEN_PATTERN.test(`stl_pat_${'a'.repeat(43)}`)).toBe(true)
    expect(TOKEN_PATTERN.test('stl_pat_short')).toBe(false)
    expect(TOKEN_PATTERN.test(`pat_${'a'.repeat(43)}`)).toBe(false)
  })
})
