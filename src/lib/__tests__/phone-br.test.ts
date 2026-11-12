import { describe, expect, it } from 'vitest'
import { toDisplayPhone, toStoredPhone } from '@/src/lib/phone-br'

describe('toStoredPhone', () => {
  it('adds 55 to DDD + number', () => {
    expect(toStoredPhone('(11) 98888-7777')).toBe('5511988887777')
    expect(toStoredPhone('1133334444')).toBe('551133334444')
  })
  it('keeps numbers that already carry a country code', () => {
    expect(toStoredPhone('+55 11 98888-7777')).toBe('5511988887777')
    expect(toStoredPhone('+1 415 555 0100')).toBe('14155550100')
  })
  it('returns null for empty input', () => {
    expect(toStoredPhone('')).toBeNull()
    expect(toStoredPhone(null)).toBeNull()
    expect(toStoredPhone('abc')).toBeNull()
  })
})

describe('toDisplayPhone', () => {
  it('hides the 55 and masks progressively', () => {
    expect(toDisplayPhone('5511988887777')).toBe('(11) 98888-7777')
    expect(toDisplayPhone('551133334444')).toBe('(11) 3333-4444')
    expect(toDisplayPhone('11988887777')).toBe('(11) 98888-7777')
    expect(toDisplayPhone('1')).toBe('(1')
    expect(toDisplayPhone('113')).toBe('(11) 3')
    expect(toDisplayPhone('')).toBe('')
  })
})
